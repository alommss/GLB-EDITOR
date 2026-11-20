import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const $ = id => document.getElementById(id);
const viewer = $('viewer');
const scene = new THREE.Scene();
scene.background = new THREE.Color($('bgColor').value);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
camera.position.set(4, 3, 5);
const renderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true, alpha:false});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
viewer.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.target.set(0, .7, 0);
let gridSize = 100;
let grid = new THREE.GridHelper(gridSize, gridSize, 0x718b60, 0x303945);
grid.position.y = 0;
scene.add(grid);
const axes = new THREE.Group();
scene.add(axes);
let axisLength = 10;
function rebuildAxes(){
  axes.children.forEach(child=>{child.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});});
  axes.clear();
  const defs=[['axisXToggle',0xff5555,new THREE.Vector3(1,0,0)],['axisYToggle',0x65d879,new THREE.Vector3(0,1,0)],['axisZToggle',0x5599ff,new THREE.Vector3(0,0,1)]];
  defs.forEach(([id,color,dir])=>{
    if(!$(id).checked)return;
    const arrow=new THREE.ArrowHelper(dir,new THREE.Vector3(0,0,0),axisLength,color,Math.max(.25,axisLength*.035),Math.max(.12,axisLength*.018));
    axes.add(arrow);
  });
}
rebuildAxes();
const ambient = new THREE.HemisphereLight(0xffffff, 0x657080, 2.0); scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xffffff, 3.0); keyLight.position.set(4,7,5); scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xb9d6ff, 1.2); fillLight.position.set(-5,2,-4); scene.add(fillLight);

let models = [];
let activeModel = null;
let selectedObject = null;
let toastTimer;
const undoStack = [], redoStack = [];
function transformState(o){return {object:o,position:o.position.clone(),rotation:o.rotation.clone(),scale:o.scale.clone()};}
function restoreTransform(s){s.object.position.copy(s.position);s.object.rotation.copy(s.rotation);s.object.scale.copy(s.scale);s.object.updateMatrixWorld(true);if(selectedObject===s.object)fillTransformInputs();if(activeModel)collectStats(getModelRoot(activeModel));}
function updateHistoryButtons(){$("undoBtn").disabled=!undoStack.length;$("redoBtn").disabled=!redoStack.length;}
function pushHistory(before,after){undoStack.push({before,after});if(undoStack.length>60)undoStack.shift();redoStack.length=0;updateHistoryButtons();}
const loader = new GLTFLoader();
const exporter = new GLTFExporter();
const objectOriginals = new WeakMap();

function notify(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function setLoading(value) {$('loading').classList.toggle('show', value);}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1024/1024).toFixed(2)} MB`;
}
function resize() {
  const w = viewer.clientWidth, h = viewer.clientHeight;
  if (!w || !h) return;
  camera.aspect = w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h,false);
}
new ResizeObserver(resize).observe(viewer);
function animate() {requestAnimationFrame(animate); controls.update(); renderer.render(scene,camera);}
animate();

function getModelRoot(model) { return model?.gltf?.scene || model?.root; }
function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x,size.y,size.z,0.1);
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(maxDim*1.8,maxDim*1.25,maxDim*1.8));
  camera.near = Math.max(maxDim/1000,0.001); camera.far = maxDim*100; camera.updateProjectionMatrix();
  controls.update();
}
function collectStats(root) {
  let meshes=0, vertices=0, triangles=0; const materials=new Set();
  root.traverse(o=>{
    if (!o.isMesh) return;
    meshes++;
    const g=o.geometry;
    if(g){vertices += g.attributes.position?.count || 0; triangles += g.index ? g.index.count/3 : (g.attributes.position?.count || 0)/3;}
    const mats=Array.isArray(o.material)?o.material:[o.material]; mats.filter(Boolean).forEach(m=>materials.add(m));
  });
  const box = new THREE.Box3().setFromObject(root), size=box.getSize(new THREE.Vector3());
  $('statMeshes').textContent=meshes.toLocaleString('en-US');
  $('statVertices').textContent=Math.round(vertices).toLocaleString('en-US');
  $('statTriangles').textContent=Math.round(triangles).toLocaleString('en-US');
  $('statMaterials').textContent=materials.size.toLocaleString('en-US');
  $('modelDimensions').textContent=box.isEmpty()?'DIMENSIONS —':`DIMENSIONS ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`;
  $('statFile').textContent=activeModel?.name || '—';
}
function updateModelList() {
  $('modelCount').textContent=`${models.length} MODEL${models.length===1?'':'S'}`;
  const list=$('modelList'); list.innerHTML='';
  if(!models.length){list.innerHTML='<div class="empty-list">Belum ada model.</div>';return;}
  models.forEach(model=>{
    const row=document.createElement('div'); row.className='model-item'+(model===activeModel?' active':'');
    const symbol=document.createElement('div');symbol.className='model-symbol';symbol.textContent='◇';
    const meta=document.createElement('div');meta.className='model-meta';
    const name=document.createElement('strong');name.textContent=model.name;
    const size=document.createElement('small');size.textContent=model.sizeLabel;
    meta.append(name,size);
    const remove=document.createElement('button');remove.className='remove-model';remove.textContent='×';remove.title='Remove model';
    remove.addEventListener('click',e=>{e.stopPropagation();removeModel(model);});
    row.append(symbol,meta,remove);row.addEventListener('click',()=>activateModel(model));list.append(row);
  });
}
function activateModel(model) {
  activeModel=model; selectedObject=null;
  models.forEach(m=>{const root=getModelRoot(m);root.visible=m===model;});
  $('welcome').style.display='none';$('exportBtn').disabled=false;$('screenshotBtn').disabled=false;
  $('viewerLabel').textContent=model.name.toUpperCase();
  $('selectionName').textContent='Pilih objek di scene';
  disableEditor(); updateModelList(); buildModelTree(); collectStats(getModelRoot(model));
}
function removeModel(model) {
  const root=getModelRoot(model);scene.remove(root);
  root.traverse(o=>{if(o.geometry)o.geometry.dispose(); if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});
  models=models.filter(m=>m!==model);
  if(activeModel===model){activeModel=models.at(-1)||null;if(activeModel)activateModel(activeModel);else{selectedObject=null;$('welcome').style.display='flex';$('exportBtn').disabled=true;$('screenshotBtn').disabled=true;$('viewerLabel').textContent='3D VIEWPORT';clearStats();disableEditor();}}
  updateModelList();
}
function clearStats(){['statMeshes','statVertices','statTriangles','statMaterials','statFile'].forEach(id=>$(id).textContent='—');$('modelDimensions').textContent='DIMENSIONS —';}
function disableEditor(){['posX','posY','posZ','rotX','rotY','rotZ','scaleX','scaleY','scaleZ','applyTransform','resetTransform','matColor','opacity'].forEach(id=>$(id).disabled=true);}
function enableEditor(){['posX','posY','posZ','rotX','rotY','rotZ','scaleX','scaleY','scaleZ','applyTransform','resetTransform','matColor','opacity'].forEach(id=>$(id).disabled=false);}
function saveOriginal(obj){if(!objectOriginals.has(obj))objectOriginals.set(obj,{position:obj.position.clone(),rotation:obj.rotation.clone(),scale:obj.scale.clone()});}
function selectObject(obj) {
  if(!obj || !activeModel)return;
  selectedObject=obj;saveOriginal(obj);enableEditor();
  $('selectionName').textContent=obj.name || obj.type || 'Object';
  buildModelTree(); fillTransformInputs();
  const mesh=obj.isMesh?obj:null;
  if(mesh && mesh.material){
    const mat=Array.isArray(mesh.material)?mesh.material[0]:mesh.material;
    if(mat.color)$('matColor').value='#'+mat.color.getHexString();
    $('opacity').value=Math.round((mat.opacity??1)*100);$('opacityValue').textContent=$('opacity').value+'%';
  }else{$('matColor').disabled=true;$('opacity').disabled=true;}
}
function fillTransformInputs(){
  if(!selectedObject)return;
  const o=selectedObject, r=THREE.MathUtils.radToDeg;
  ['posX','posY','posZ'].forEach((id,i)=>$(id).value=o.position.getComponent(i).toFixed(3));
  ['rotX','rotY','rotZ'].forEach((id,i)=>$(id).value=r(o.rotation.getComponent(i)).toFixed(1));
  ['scaleX','scaleY','scaleZ'].forEach((id,i)=>$(id).value=o.scale.getComponent(i).toFixed(3));
}
function buildModelTree(){
  const host=$('modelTree');host.innerHTML='';
  if(!activeModel){host.innerHTML='<div class="tree-empty">Import model untuk melihat strukturnya.</div>';$('objectCount').textContent='0 OBJECT';return;}
  const root=getModelRoot(activeModel);let count=0;
  root.traverse(()=>count++);$('objectCount').textContent=`${count} OBJECT`;
  function addNode(obj,depth,parent){
    const row=document.createElement('div');row.className='tree-node'+(selectedObject===obj?' selected':'');
    const indent=document.createElement('span');indent.className='tree-indent';indent.style.width=`${depth*12}px`;
    const hasChildren=obj.children.length>0;
    const fold=document.createElement('button');fold.className='tree-toggle';fold.textContent=hasChildren?'▾':'·';fold.disabled=!hasChildren;
    const label=document.createElement('button');label.className='tree-select';label.textContent=obj.name||obj.type||'Object';label.title=label.textContent;
    const type=document.createElement('span');type.className='tree-type';type.textContent=obj.isMesh?'MESH':obj.type.toUpperCase();
    const eye=document.createElement('button');eye.className='tree-eye'+(!obj.visible?' hidden-object':'');eye.textContent=obj.visible?'◉':'○';eye.title=obj.visible?'Hide object':'Show object';
    row.append(indent,fold,label,type,eye);parent.append(row);
    const children=document.createElement('div');children.className='tree-children';parent.append(children);
    obj.children.forEach(child=>addNode(child,depth+1,children));
    fold.addEventListener('click',()=>{const closed=children.style.display==='none';children.style.display=closed?'':'none';fold.textContent=closed?'▾':'▸';});
    label.addEventListener('click',()=>selectObject(obj));
    eye.addEventListener('click',()=>{obj.visible=!obj.visible;eye.textContent=obj.visible?'◉':'○';eye.classList.toggle('hidden-object',!obj.visible);eye.title=obj.visible?'Hide object':'Show object';if(activeModel)collectStats(root);});
  }
  addNode(root,0,host);
}
$('expandTreeBtn').addEventListener('click',()=>document.querySelectorAll('.tree-children').forEach(el=>el.style.display=''));
$('collapseTreeBtn').addEventListener('click',()=>document.querySelectorAll('.tree-children').forEach(el=>el.style.display='none'));

const raycaster=new THREE.Raycaster(), pointer=new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown',e=>{
  if(e.button!==0)return;
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.x=((e.clientX-rect.left)/rect.width)*2-1;
  pointer.y=-((e.clientY-rect.top)/rect.height)*2+1;
  raycaster.setFromCamera(pointer,camera);
  const roots=models.filter(m=>m===activeModel).map(getModelRoot);
  const hits=raycaster.intersectObjects(roots,true);
  if(hits.length){let target=hits[0].object;selectObject(target);}
});
$('applyTransform').addEventListener('click',()=>{
  if(!selectedObject)return;const o=selectedObject;const before=transformState(o);
  ['posX','posY','posZ'].forEach((id,i)=>o.position.setComponent(i,Number($(id).value)||0));
  ['rotX','rotY','rotZ'].forEach((id,i)=>o.rotation.setComponent(i,THREE.MathUtils.degToRad(Number($(id).value)||0)));
  ['scaleX','scaleY','scaleZ'].forEach((id,i)=>o.scale.setComponent(i,Number($(id).value)||0));
  o.updateMatrixWorld(true);const after=transformState(o);pushHistory(before,after);collectStats(getModelRoot(activeModel));notify('Transform berhasil diterapkan.');
});
$('resetTransform').addEventListener('click',()=>{
  if(!selectedObject)return;const s=objectOriginals.get(selectedObject);if(!s)return;const before=transformState(selectedObject);
  selectedObject.position.copy(s.position);selectedObject.rotation.copy(s.rotation);selectedObject.scale.copy(s.scale);const after=transformState(selectedObject);pushHistory(before,after);fillTransformInputs();collectStats(getModelRoot(activeModel));
});
$('undoBtn').addEventListener('click',()=>{const item=undoStack.pop();if(!item)return;restoreTransform(item.before);redoStack.push(item);updateHistoryButtons();});
$('redoBtn').addEventListener('click',()=>{const item=redoStack.pop();if(!item)return;restoreTransform(item.after);undoStack.push(item);updateHistoryButtons();});
$('matColor').addEventListener('input',()=>{
  if(!selectedObject?.isMesh)return;
  const mats=Array.isArray(selectedObject.material)?selectedObject.material:[selectedObject.material];
  mats.forEach(m=>{if(m.color)m.color.set($('matColor').value);}); 
});
$('opacity').addEventListener('input',()=>{
  const v=Number($('opacity').value)/100;$('opacityValue').textContent=$('opacity').value+'%';
  if(!selectedObject?.isMesh)return;
  const mats=Array.isArray(selectedObject.material)?selectedObject.material:[selectedObject.material];
  mats.forEach(m=>{m.transparent=v<1;m.opacity=v;m.depthWrite=v>=1;m.needsUpdate=true;});
});
$('bgColor').addEventListener('input',()=>scene.background=new THREE.Color($('bgColor').value));
$('gridToggle').addEventListener('change',e=>grid.visible=e.target.checked);
$('gridSize').addEventListener('input',e=>{
  gridSize=Number(e.target.value);$('gridSizeValue').textContent=gridSize;
  scene.remove(grid);grid.geometry.dispose();(Array.isArray(grid.material)?grid.material:[grid.material]).forEach(m=>m.dispose());
  grid=new THREE.GridHelper(gridSize,gridSize,0x718b60,0x303945);grid.position.y=0;grid.visible=$('gridToggle').checked;scene.add(grid);
});
['axisXToggle','axisYToggle','axisZToggle'].forEach(id=>$(id).addEventListener('change',rebuildAxes));
$('axisLength').addEventListener('input',e=>{axisLength=Number(e.target.value);$('axisLengthValue').textContent=axisLength;rebuildAxes();});
$('lightMode').addEventListener('change',e=>{
  const mode=e.target.value;
  ambient.intensity=mode==='bright'?2.8:mode==='soft'?1.5:2.0;
  keyLight.intensity=mode==='bright'?4.2:mode==='soft'?1.7:3.0;
  fillLight.intensity=mode==='soft'?1.8:mode==='bright'?.7:1.2;
});

function loadFiles(fileList) {
  const files=Array.from(fileList);
  const modelFiles=files.filter(f=>/\.(glb|gltf)$/i.test(f.name));
  if(!modelFiles.length){notify('Pilih file .glb atau .gltf.');return;}
  const fileMap=new Map(files.map(f=>[f.name,URL.createObjectURL(f)]));
  modelFiles.forEach(file=>loadOne(file,fileMap));
}
function loadOne(file,fileMap) {
  setLoading(true);
  const manager=new THREE.LoadingManager();
  manager.setURLModifier(url=>{
    const clean=decodeURIComponent(url.split(/[?#]/)[0]);
    const base=clean.split('/').pop();
    if(fileMap.has(base))return fileMap.get(base);
    return url;
  });
  const localLoader=new GLTFLoader(manager);
  const reader=new FileReader();
  reader.onerror=()=>{setLoading(false);notify('Gagal membaca file.');};
  reader.onload=()=>{
    const data=reader.result;
    const parseData=data instanceof ArrayBuffer?data:data;
    const basePath=URL.createObjectURL(new Blob(['']));
    localLoader.parse(parseData,basePath,gltf=>{
      const root=gltf.scene;
      root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;if(!o.name)o.name='Mesh';}});
      scene.add(root);
      const model={name:file.name,size:file.size,sizeLabel:formatBytes(file.size),gltf,root};
      models.push(model);activateModel(model);frameObject(root);updateModelList();collectStats(root);
      setLoading(false);notify(`${file.name} berhasil diimport.`);
      // Object URLs are kept alive while model textures may still need them.
      model.objectUrls=[...fileMap.values()];
    },err=>{console.error(err);setLoading(false);notify('File GLTF tidak valid atau resource pendukung tidak ditemukan.');});
  };
  if(file.name.toLowerCase().endsWith('.glb'))reader.readAsArrayBuffer(file);
  else reader.readAsText(file);
}
function openPicker(){$('fileInput').click();}
$('openBtn').addEventListener('click',openPicker);$('welcomeImport').addEventListener('click',openPicker);
$('fileInput').addEventListener('change',e=>{loadFiles(e.target.files);e.target.value='';});
const dropzone=$('dropzone');
['dragenter','dragover'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.add('dragover');}));
['dragleave','drop'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.remove('dragover');}));
dropzone.addEventListener('drop',e=>loadFiles(e.dataTransfer.files));
document.addEventListener('dragover',e=>{e.preventDefault();document.body.classList.add('dragging');});
document.addEventListener('dragleave',e=>{if(e.relatedTarget===null)document.body.classList.remove('dragging');});
document.addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragging');if(e.target.closest('#dropzone'))return;loadFiles(e.dataTransfer.files);});
$('resetCamera').addEventListener('click',()=>{if(activeModel)frameObject(getModelRoot(activeModel));else{camera.position.set(4,3,5);controls.target.set(0,0,0);controls.update();}});
$('screenshotBtn').addEventListener('click',()=>{
  renderer.render(scene,camera);
  const a=document.createElement('a');a.download='glb-studio-preview.png';a.href=renderer.domElement.toDataURL('image/png');a.click();notify('Screenshot PNG disimpan.');
});
$('fullscreenBtn').addEventListener('click',async()=>{
  const el=$('viewerWrap');try{if(!document.fullscreenElement)await el.requestFullscreen();else await document.exitFullscreen();}catch{notify('Fullscreen tidak didukung browser ini.')}
});
$('exportBtn').addEventListener('click',async()=>{
  if(!activeModel)return;
  const choice=prompt('Ketik GLB atau GLTF untuk format export:','GLB');
  if(!choice)return;const binary=choice.trim().toLowerCase()==='glb';
  if(!binary && choice.trim().toLowerCase()!=='gltf'){notify('Format harus GLB atau GLTF.');return;}
  setLoading(true);
  try{
    const root=getModelRoot(activeModel);
    const result=await new Promise((resolve,reject)=>exporter.parse(root,resolve,reject,{binary,embedImages:true,onlyVisible:true}));
    let blob,filename;
    if(binary){blob=new Blob([result],{type:'model/gltf-binary'});filename=activeModel.name.replace(/\.[^.]+$/,'')+'.glb';}
    else{blob=new Blob([JSON.stringify(result,null,2)],{type:'model/gltf+json'});filename=activeModel.name.replace(/\.[^.]+$/,'')+'.gltf';}
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
    notify(`Export ${binary?'GLB':'GLTF'} berhasil.`);
  }catch(err){console.error(err);notify('Export gagal. Periksa console untuk detail.');}
  finally{setLoading(false);}
});
window.addEventListener('beforeunload',()=>models.forEach(m=>(m.objectUrls||[]).forEach(URL.revokeObjectURL)));
resize();
