import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- DEFINICIÓN DE BLOQUES Y GENERADORES ---
Blockly.Blocks['move_joint'] = {
  init: function() { this.appendDummyInput().appendField("Mover").appendField(new Blockly.FieldDropdown([["Base", "base"], ["Hombro", "shoulder"], ["Codo", "elbow"], ["Giro Pinza", "gripRot"]]), "JOINT").appendField(new Blockly.FieldDropdown([["a la Derecha ⟳", "derecha"], ["a la Izquierda ⟲", "izquierda"], ["Arriba ᐃ", "arriba"], ["Abajo ᐁ", "abajo"]]), "DIRECTION"); this.appendValueInput("DEGREES").setCheck("Number").appendField("grados:"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(230); }
};
Blockly.JavaScript['move_joint'] = function(block) {
  const joint = block.getFieldValue('JOINT');
  const direction = block.getFieldValue('DIRECTION');
  const degrees = Blockly.JavaScript.valueToCode(block, 'DEGREES', Blockly.JavaScript.ORDER_ATOMIC) || 0;
  return `await api.moveJoint('${joint}', '${direction}', ${degrees});\n`;
};
Blockly.Blocks['gripper_control'] = {
    init: function() { this.appendDummyInput().appendField(new Blockly.FieldDropdown([["Cerrar", "close"], ["Abrir", "open"]]), "ACTION").appendField("Pinza"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(210); }
};
Blockly.JavaScript['gripper_control'] = function(block) {
    const action = block.getFieldValue('ACTION');
    return `await api.${action}Gripper();\n`;
};
Blockly.Blocks['wait_seconds'] = {
  init: function() { this.appendValueInput("SECONDS").setCheck("Number").appendField("Esperar"); this.appendDummyInput().appendField("segundos"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(120); }
};
Blockly.JavaScript['wait_seconds'] = function(block) {
    const seconds = Blockly.JavaScript.valueToCode(block, 'SECONDS', Blockly.JavaScript.ORDER_ATOMIC) || 0;
    return `await api.wait(${seconds});\n`;
};
Blockly.Blocks['go_home'] = {
  init: function() { this.appendDummyInput().appendField("Volver a Posición Inicial 🏠"); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(230); this.setTooltip("Mueve el robot a su posición de reposo inicial."); }
};
Blockly.JavaScript['go_home'] = function(block) {
  return `await api.goHome();\n`;
};
Blockly.Blocks['is_box_underneath'] = {
    init: function() { this.appendDummyInput().appendField("¿Hay caja debajo?"); this.setOutput(true, "Boolean"); this.setColour(20); this.setTooltip("Devuelve verdadero si la pinza está sobre una caja."); }
};
Blockly.JavaScript['is_box_underneath'] = function(block) {
    return ['await api.isBoxUnderneath()', Blockly.JavaScript.ORDER_ATOMIC];
};
Blockly.Blocks['get_box_color'] = {
  init: function() { this.appendDummyInput().appendField("Color de la caja debajo"); this.setOutput(true, "String"); this.setColour(20); this.setTooltip("Devuelve el color de la caja ('rojo', 'verde', 'azul') o 'ninguno'."); }
};
Blockly.JavaScript['get_box_color'] = function(block) {
    return ['await api.getBoxColor()', Blockly.JavaScript.ORDER_ATOMIC];
};
Blockly.Blocks['move_belt'] = {
  init: function() { this.appendDummyInput().appendField("Mover").appendField(new Blockly.FieldDropdown([["Cinta 1 (Izquierda)", "1"], ["Cinta 2 (Derecha)", "2"]]), "BELT_ID").appendField("adelante"); this.appendValueInput("STEPS").setCheck("Number"); this.appendDummyInput().appendField("pasos"); this.setInputsInline(true); this.setPreviousStatement(true, null); this.setNextStatement(true, null); this.setColour(120); this.setTooltip("Avanza la cinta seleccionada un número de 'pasos'."); }
};
Blockly.JavaScript['move_belt'] = function(block) {
    const beltId = block.getFieldValue('BELT_ID');
    const steps = Blockly.JavaScript.valueToCode(block, 'STEPS', Blockly.JavaScript.ORDER_ATOMIC) || 0;
    return `await api.moveBelt(${beltId}, ${steps});\n`;
};
Blockly.JavaScript['variables_set'] = function(block) {
  const argument0 = Blockly.JavaScript.valueToCode(block, 'VALUE', Blockly.JavaScript.ORDER_ASSIGNMENT) || '0';
  const varName = Blockly.JavaScript.nameDB_.getName( block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME );
  const code = `${varName} = ${argument0};\n`;
  const updateCode = `await api.updateVariableDisplay('${varName}', ${varName});\n`;
  return code + updateCode;
};

// --- VARIABLES GLOBALES ---
let scene, camera, renderer, controls;
let robotArm = {};
let boxes = [];
let heldBox = null;
let statusText;
let workspace;
let beltMoveTime = { 1: 0, 2: 0 };
let raycaster;
let variableState = {};
let variableListDiv;
const homeAngles = { base: 0, shoulder: 20, elbow: 20, gripRot: 0, gripOpen: 0.5 };
const angles = { target: { ...homeAngles }, current: { ...homeAngles } };
const BOX_COLORS = { rojo: 0xff0000, verde: 0x00ff00, azul: 0x0000ff };
const COLOR_NAMES = Object.keys(BOX_COLORS);

// --- API DE CONTROL DEL ROBOT ---
const api = {
    moveJoint: async function(joint, direction, degrees) {
        statusText.textContent = `Moviendo ${joint} ${direction} ${degrees}°...`;
        let multiplier = (direction === 'derecha' || direction === 'abajo') ? 1 : -1;
        if (joint === 'shoulder' || joint === 'elbow') {
            if (direction === 'arriba') multiplier = -1;
            if (direction === 'abajo') multiplier = 1;
        }
        angles.target[joint] += degrees * multiplier;
        await this.waitForMovement();
    },
    openGripper: async function() {
        statusText.textContent = 'Abriendo pinza...';
        angles.target.gripOpen = 0.5;
        await this.wait(0.5);
        if (heldBox) {
            scene.attach(heldBox.mesh);
            const gripperPosition = new THREE.Vector3();
            robotArm.gripperPivot.getWorldPosition(gripperPosition);
            heldBox.mesh.position.y = 0.6;
            if (gripperPosition.x > 0) { heldBox.onBelt = 2; heldBox.mesh.position.x = 4; }
            else { heldBox.onBelt = 1; heldBox.mesh.position.x = -4; }
            heldBox = null;
        }
    },
    closeGripper: async function() {
        statusText.textContent = 'Cerrando pinza...';
        angles.target.gripOpen = 0.1;
        await this.wait(0.5);
        if (!heldBox) {
            const gripperPosition = new THREE.Vector3();
            robotArm.gripperPivot.getWorldPosition(gripperPosition);
            for (const box of boxes) {
                const boxPosition = new THREE.Vector3();
                box.mesh.getWorldPosition(boxPosition);
                if (box.onBelt > 0 && gripperPosition.distanceTo(boxPosition) < 1.0) {
                    robotArm.gripperPivot.attach(box.mesh);
                    heldBox = box;
                    box.onBelt = 0;
                    break;
                }
            }
        }
    },
    isBoxUnderneath: async function() {
        const gripperPosition = new THREE.Vector3();
        robotArm.gripperPivot.getWorldPosition(gripperPosition);
        const downDirection = new THREE.Vector3(0, -1, 0);
        raycaster.set(gripperPosition, downDirection);
        const boxMeshes = boxes.filter(b => b.onBelt > 0).map(b => b.mesh);
        if (boxMeshes.length === 0) {
            this.visualizeRay(gripperPosition, downDirection, 100, 0xff0000);
            return false;
        }
        const intersects = raycaster.intersectObjects(boxMeshes);
        if (intersects.length > 0 && intersects[0].distance < 3.5) {
            this.visualizeRay(gripperPosition, downDirection, intersects[0].distance, 0x00ff00);
            return true;
        }
        this.visualizeRay(gripperPosition, downDirection, 100, 0xff0000);
        return false;
    },
    getBoxColor: async function() {
        const gripperPosition = new THREE.Vector3();
        robotArm.gripperPivot.getWorldPosition(gripperPosition);
        raycaster.set(gripperPosition, new THREE.Vector3(0, -1, 0));
        const boxMeshes = boxes.map(b => b.mesh);
        if (boxMeshes.length === 0) return 'ninguno';
        const intersects = raycaster.intersectObjects(boxMeshes);
        if (intersects.length > 0 && intersects[0].distance < 3.5) {
            const intersectedMesh = intersects[0].object;
            const boxData = boxes.find(b => b.mesh.uuid === intersectedMesh.uuid);
            if (boxData) {
                this.visualizeRay(gripperPosition, new THREE.Vector3(0, -1, 0), intersects[0].distance, BOX_COLORS[boxData.color]);
                return boxData.color;
            }
        }
        this.visualizeRay(gripperPosition, new THREE.Vector3(0, -1, 0), 100, 0xff0000);
        return 'ninguno';
    },
    moveBelt: async function(beltId, steps) {
        statusText.textContent = `Moviendo Cinta ${beltId} ${steps} pasos...`;
        const duration = steps * 0.25;
        beltMoveTime[beltId] = duration;
        await this.wait(duration);
    },
    wait: async function(seconds) {
        statusText.textContent = `Esperando ${seconds}s...`;
        return new Promise(resolve => setTimeout(resolve, seconds * 1000));
    },
    waitForMovement: function() {
        return new Promise(resolve => {
            const check = () => {
                let done = true;
                for (const key of ['base', 'shoulder', 'elbow', 'gripRot']) {
                    if (Math.abs(angles.current[key] - angles.target[key]) > 0.5) { done = false; break; }
                }
                if (done) resolve(); else requestAnimationFrame(check);
            };
            check();
        });
    },
    goHome: async function() {
        statusText.textContent = 'Volviendo a posición inicial...';
        angles.target = { ...homeAngles };
        await this.waitForMovement();
    },
    visualizeRay: function(origin, direction, length, color) {
        const end = new THREE.Vector3().copy(origin).addScaledVector(direction, length);
        const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
        const material = new THREE.LineBasicMaterial({ color: color });
        const line = new THREE.Line(geometry, material);
        scene.add(line);
        setTimeout(() => { scene.remove(line); }, 250);
    },
    updateVariableDisplay: async function(name, value) {
        variableState[name] = value;
        let html = '';
        const sortedKeys = Object.keys(variableState).sort();
        if (sortedKeys.length === 0) { html = 'Crea una variable para verla aquí.'; } 
        else {
            for (const key of sortedKeys) {
                let displayValue = variableState[key];
                if (typeof displayValue === 'string') { displayValue = `"${displayValue}"`; }
                if (displayValue === undefined) { displayValue = ' indefinido'; }
                html += `<div class="variable-item"><span class="variable-name">${key}:</span> <span class="variable-value">${displayValue}</span></div>`;
            }
        }
        variableListDiv.innerHTML = html;
        return Promise.resolve();
    }
};
window.api = api;

// --- FUNCIONES DE LA INTERFAZ ---
async function runCode() {
    variableState = {};
    const allVars = workspace.getVariableMap().getAllVariables();
    if (allVars.length > 0) {
        allVars.forEach(v => { variableState[v.name] = undefined; });
    }
    await api.updateVariableDisplay();
    Blockly.JavaScript.INFINITE_LOOP_TRAP = null;
    const code = Blockly.JavaScript.workspaceToCode(workspace);
    statusText.textContent = 'Ejecutando programa...';
    document.getElementById('run-btn').disabled = true;
    try {
        await eval(`(async () => { ${code} })()`);
        statusText.textContent = '¡Programa completado!';
    } catch (e) {
        statusText.textContent = `Error: ${e.message}`;
        console.error(e);
    }
    document.getElementById('run-btn').disabled = false;
}
function saveWorkspace() {
    try {
        const json = Blockly.serialization.workspaces.save(workspace);
        const jsonString = JSON.stringify(json, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'programa_robot.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        statusText.textContent = "Programa guardado.";
    } catch (e) {
        statusText.textContent = "Error al guardar el programa.";
        console.error(e);
    }
}
function loadWorkspace(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const json = JSON.parse(e.target.result);
            Blockly.serialization.workspaces.load(json, workspace);
            statusText.textContent = "Programa cargado.";
        } catch (e) {
            statusText.textContent = "Error: El fichero no es válido.";
            console.error(e);
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// --- BUCLE DE ANIMACIÓN Y LÓGICA 3D ---
let lastTime = 0;
function animate(time) {
    requestAnimationFrame(animate);
    const deltaTime = (time - lastTime) * 0.001 || 0;
    lastTime = time;
    for (const beltId in beltMoveTime) {
        if (beltMoveTime[beltId] > 0) {
            boxes.forEach(box => {
                if (box.onBelt == beltId) {
                    box.mesh.position.z += 2 * deltaTime;
                    if (box.mesh.position.z > 6) { box.mesh.position.z = -6; }
                }
            });
            beltMoveTime[beltId] -= deltaTime;
        }
    }
    if (!document.getElementById('run-btn').disabled) {
        statusText.textContent = "Listo para programar.";
    }
    for (const key in angles.current) {
        angles.current[key] = THREE.MathUtils.lerp(angles.current[key], angles.target[key], 0.1);
    }
    if (robotArm.base) {
        robotArm.base.rotation.y = THREE.MathUtils.degToRad(angles.current.base);
        robotArm.shoulderPivot.rotation.x = THREE.MathUtils.degToRad(angles.current.shoulder);
        robotArm.elbowPivot.rotation.x = THREE.MathUtils.degToRad(angles.current.elbow);
        robotArm.gripperPivot.rotation.y = THREE.MathUtils.degToRad(angles.current.gripRot);
        const gripDistance = 0.2 + angles.current.gripOpen * 0.3;
        robotArm.finger1.position.x = gripDistance;
        robotArm.finger2.position.x = -gripDistance;
    }
    controls.update();
    renderer.render(scene, camera);
}

// --- CREACIÓN DE LA ESCENA ---
function createRobotArm() {
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x0077ff, metalness: 0.5, roughness: 0.4 });
    const armMat1 = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.7, roughness: 0.3 });
    const armMat2 = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.7, roughness: 0.3 });
    const gripperMat = new THREE.MeshStandardMaterial({ color: 0xffff00, metalness: 0.2, roughness: 0.8 });
    const jointMat = new THREE.MeshStandardMaterial({ color: 0xff4500, metalness: 0.3, roughness: 0.5 });
    robotArm.base = new THREE.Group(); scene.add(robotArm.base);
    const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 0.5, 32), baseMat); baseMesh.castShadow = true; baseMesh.receiveShadow = true; robotArm.base.add(baseMesh);
    robotArm.shoulderPivot = new THREE.Group(); robotArm.shoulderPivot.position.y = 0.25; robotArm.base.add(robotArm.shoulderPivot);
    const shoulderJoint = new THREE.Mesh(new THREE.SphereGeometry(0.4), jointMat); shoulderJoint.castShadow = true; robotArm.shoulderPivot.add(shoulderJoint);
    const arm1 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3, 0.5), armMat1); arm1.position.y = 1.5; arm1.castShadow = true; arm1.receiveShadow = true; robotArm.shoulderPivot.add(arm1);
    robotArm.elbowPivot = new THREE.Group(); robotArm.elbowPivot.position.y = 3; robotArm.shoulderPivot.add(robotArm.elbowPivot);
    const elbowJoint = new THREE.Mesh(new THREE.SphereGeometry(0.3), jointMat); elbowJoint.castShadow = true; robotArm.elbowPivot.add(elbowJoint);
    const arm2 = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.5, 0.4), armMat2); arm2.position.y = 1.25; arm2.castShadow = true; arm2.receiveShadow = true; robotArm.elbowPivot.add(arm2);
    robotArm.gripperPivot = new THREE.Group(); robotArm.gripperPivot.position.y = 2.5; robotArm.elbowPivot.add(robotArm.gripperPivot);
    const gripperBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.4), jointMat); gripperBase.castShadow = true; robotArm.gripperPivot.add(gripperBase);
    const fingerGeom = new THREE.BoxGeometry(0.1, 0.6, 0.2);
    robotArm.finger1 = new THREE.Mesh(fingerGeom, gripperMat); robotArm.finger2 = new THREE.Mesh(fingerGeom, gripperMat);
    robotArm.finger1.castShadow = true; robotArm.finger2.castShadow = true; robotArm.gripperPivot.add(robotArm.finger1, robotArm.finger2);
}
function createConveyorBelts() {
    const beltGeo = new THREE.BoxGeometry(2, 0.2, 12);
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9 });
    const belt1 = new THREE.Mesh(beltGeo, beltMat); belt1.position.set(-4, 0.1, 0); belt1.receiveShadow = true; scene.add(belt1);
    const belt2 = new THREE.Mesh(beltGeo, beltMat); belt2.position.set(4, 0.1, 0); belt2.receiveShadow = true; scene.add(belt2);
}
function createBoxes() {
    const boxGeo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    for (let i = 0; i < 6; i++) {
        const randomColorName = COLOR_NAMES[Math.floor(Math.random() * COLOR_NAMES.length)];
        const boxMat = new THREE.MeshStandardMaterial({ color: BOX_COLORS[randomColorName], roughness: 0.7 });
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(-4, 0.6, -5 - i * 4);
        box.castShadow = true;
        const boxObject = { mesh: box, onBelt: 1, color: randomColorName };
        boxes.push(boxObject);
        scene.add(box);
    }
}

function resetSimulation() {
    beltMoveTime = { 1: 0, 2: 0 };
    angles.target = { ...homeAngles };
    angles.current = { ...homeAngles };

    if (heldBox) {
        scene.remove(heldBox.mesh);
        heldBox = null;
    }

    boxes.forEach(box => {
        scene.remove(box.mesh);
    });
    boxes = [];

    createBoxes(); // Esta función ya existe en tu main.js, la reutilizamos

    variableState = {};
    api.updateVariableDisplay();

    document.getElementById('run-btn').disabled = false;
    statusText.textContent = "Simulación reiniciada. Programa conservado.";
}

// --- FUNCIÓN PRINCIPAL DE ARRANQUE ---
function main() {
    const simPanel = document.getElementById('simulation-panel');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    camera = new THREE.PerspectiveCamera(50, simPanel.clientWidth / simPanel.clientHeight, 0.1, 1000);
    camera.position.set(0, 5, 12);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(simPanel.clientWidth, simPanel.clientHeight);
    simPanel.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.5);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    scene.add(dirLight);
    scene.add(new THREE.GridHelper(20, 20));

    createRobotArm();
    createConveyorBelts();
    createBoxes();

    raycaster = new THREE.Raycaster();
    variableListDiv = document.getElementById('variable-list');

    const blocklyDiv = document.getElementById('blockly-div');
    const toolbox = document.getElementById('toolbox');
    workspace = Blockly.inject(blocklyDiv, { toolbox });
    
    // Inicializar el monitor con las variables existentes
    workspace.addChangeListener((event) => {
        if (event.type == Blockly.Events.VAR_CREATE || 
            event.type == Blockly.Events.VAR_DELETE ||
            event.type == Blockly.Events.VAR_RENAME) {
            
            variableState = {};
            const allVars = workspace.getVariableMap().getAllVariables();
            if (allVars.length > 0) {
                allVars.forEach(v => { variableState[v.name] = undefined; });
            }
            api.updateVariableDisplay();
        }
    });

    document.getElementById('run-btn').addEventListener('click', runCode);
    document.getElementById('reset-btn').addEventListener('click', resetSimulation);
    document.getElementById('save-btn').addEventListener('click', saveWorkspace);
    document.getElementById('load-btn').addEventListener('click', () => document.getElementById('load-input').click());
    document.getElementById('load-input').addEventListener('change', loadWorkspace);

    statusText = document.getElementById('status-text');

    animate();
}

// --- ARRANQUE ---
main();