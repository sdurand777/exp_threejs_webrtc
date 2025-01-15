/*
 *
 * This file sets up our web app with 3D scene and communications.
 *
 */

import * as THREE from "three";

import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'

import { Communications } from "./communications.js";
import { FirstPersonControls } from "./libs/firstPersonControls.js";

import msgpack from 'msgpack-lite';

// load utils pour grpc-web
const { SlamServiceClient } = require('./slam_service_grpc_web_pb.js');
//const { Empty } = require('./pointcloud_pb.js');
const { Empty } = require('google-protobuf/google/protobuf/empty_pb.js');



// lerp value to be used when interpolating positions and rotations
let lerpValue = 0;

let camera, renderer, scene;
let controls;
let listener;
let communications;

let frameCount = 0;
let peers = {};

function init() {
    scene = new THREE.Scene();


    console.log("Scene Init ....");


    // Charger le fichier PLY
    const loader = new PLYLoader();
    loader.load('./ant.ply', function (geometry) {
        // Appliquer les matériaux
        geometry.computeVertexNormals(); // Calculer les normales si nécessaire

        // Créer un matériau utilisant la texture
        const antmaterial = new THREE.MeshStandardMaterial({
        });

        const mesh = new THREE.Mesh(geometry, antmaterial);

        // Ajuster la position de l'objet
        mesh.position.set(0, 0, 0); // Ajustez les valeurs x, y, z selon votre besoin
        // Modifier l'échelle du mesh (ici un facteur d'échelle de 2 pour chaque axe)
        mesh.scale.set(0.1, 0.1, 0.1); // x, y, z

        // Ajouter le mesh à la scène
        scene.add(mesh);
        
        console.log("Added Ply ....");
    });

    // Création d'une géométrie sphérique
    const radius = 1; // Rayon de la sphère
    const widthSegments = 32; // Segments horizontaux (plus il y en a, plus c'est précis)
    const heightSegments = 32; // Segments verticaux
    const sphereGeometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments);

    // Création d'un matériau pour la sphère
    const sphereMaterial = new THREE.MeshStandardMaterial({
        color: 0xff0000, // Couleur rouge
        roughness: 0.5, // Apparence rugueuse
        metalness: 0.1, // Apparence métallique
    });

    // Création du maillage (Mesh)
    console.log("sphere loaded ...")
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);

    // Ajout de la sphère à la scène
    scene.add(sphere);

  communications = new Communications();

  communications.on("peerJoined", (id) => {
    addPeer(id);
    console.log(`Nouveau client connecté : ${id}`);

  });
  communications.on("peerLeft", (id) => {
    removePeer(id);
  });
  communications.on("positions", (positions) => {
    updatePeerPositions(positions);
  });

  // // deal with incoming data
  //   communications.on("data", (msg) => {
  //       console.log("Received message:", msg);
  //       if (msg.type == "box") {
  //           onNewBox(msg);
  //       } else if (msg.type === "points") {
  //           onNewPoints(msg);
  //       }
  //   });


    // communications.on("data", (encodedMsg) => {
    //   console.log("Message brut reçu :", encodedMsg);
    //
    //   try {
    //     //const msg = msgpack.decode(encodedMsg);
    //     // Décoder les données reçues avec msgpack
    //     const msg = msgpack.decode(new Uint8Array(encodedMsg));
    //     console.log("Message décodé :", msg);
    //     if (msg.type === "points") {
    //       onNewPoints(msg);
    //     }
    //   } catch (err) {
    //     console.error("Erreur lors du décodage des données :", err);
    //   }
    // });



  let width = window.innerWidth;
  let height = window.innerHeight * 0.9;

  camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 5000);
  camera.position.set(0, 3, 6);
  scene.add(camera);

  // // create an AudioListener and add it to the camera
  // listener = new THREE.AudioListener();
  // camera.add(listener);

  //THREE WebGL renderer
  renderer = new THREE.WebGLRenderer({
    antialiasing: true,
  });
  renderer.setClearColor(new THREE.Color("lightblue"));
  renderer.setSize(width, height);

  // add controls:
  controls = new FirstPersonControls(scene, camera, renderer);

  // add controls for adding boxes on a key press
  window.addEventListener("keyup", (ev) => {
    if (ev.key === "b") {
      addBox();
    }
  });

  //Push the canvas to the DOM
  let domElement = document.getElementById("canvas-container");
  domElement.append(renderer.domElement);

  //Setup event listeners for events and handle the states
  window.addEventListener("resize", (e) => onWindowResize(e), false);

  // Helpers
  scene.add(new THREE.GridHelper(500, 500));
  scene.add(new THREE.AxesHelper(10));

  addLights();

  // Start the loop
  update();
}

init();

// streaming grpc web

// Crée un client gRPC-Web
const client = new SlamServiceClient('http://192.168.51.30:8080', null, null);

// Appelle le serveur pour recevoir le flux de points
const request = new Empty();

const stream = client.getPointCloud(request, {});


// stream.on('data', (response) => {
//     const points = response.getPointsList();
//     addAllPoints(points);  // Ajouter tous les points en une seule fois
//     // points.forEach((point) => {
//     //     const x = point.getX();
//     //     const y = point.getY();
//     //     const z = point.getZ();
//     //     console.log(`Point reçu: x=${x}, y=${y}, z=${z}`);
//     // });
// });

async function processStreamData(points) {
    // Utilisation de setTimeout pour différer l'ajout des points à la scène
    return new Promise(resolve => {
        setTimeout(() => {
            addAllPoints(points);
            resolve();  // Résoudre la promesse après le traitement
        }, 0);  // Délai de 0 pour passer après le cycle de rendu
    });
}

stream.on('data', async (response) => {
    const points = response.getPointsList();
    await processStreamData(points);  // Attendez que les points soient ajoutés après le rendu
});



stream.on('error', (err) => {
  console.error('Erreur du flux:', err.message);
});

stream.on('end', () => {
  console.log('Flux terminé');
});


// Créer un tableau pour stocker les positions des points
let pointsGeometry = new THREE.BufferGeometry();
let pointsMaterial = new THREE.PointsMaterial({
  color: 0xff0000,  // Rouge
  size: 0.1,        // Taille des points
  sizeAttenuation: true  // Appliquer une diminution de la taille selon la distance
});

let positions = [];  // Tableau global pour stocker les positions des points



// Fonction pour ajouter des points en une seule fois
function addAllPoints(pointsList) {
    // Vider les positions existantes pour mettre à jour avec les nouvelles
    //positions = [];

    // Remplir le tableau de positions avec les coordonnées de tous les points
    pointsList.forEach((point) => {
        const x = point.getX();
        const y = point.getY();
        const z = point.getZ();
        positions.push(x, y, z);
    });

    // Mettre à jour la géométrie en une seule fois avec toutes les positions
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    // Si les points n'ont pas encore été ajoutés à la scène, les ajouter
    if (!scene.getObjectByName("points")) {
        const points = new THREE.Points(pointsGeometry, pointsMaterial);
        points.name = "points";  // Nommer l'objet pour le retrouver facilement
        scene.add(points);
    }

    // // Envoyer les points via WebSocket
    // const formattedPoints = pointsList.map(point => ({
    //     x: point.getX(),
    //     y: point.getY(),
    //     z: point.getZ()
    // }));

    // communications.sendData({
    //     type: "points",
    //     data: formattedPoints
    // });





    // const compressedData = msgpack.encode({
    //     type: "points",
    //     data: formattedPoints,
    // });
    //
    // communications.sendData(compressedData);

}

//////////////////////////////////////////////////////////////////////
// Lighting 💡
//////////////////////////////////////////////////////////////////////

function addLights() {
  scene.add(new THREE.AmbientLight(0xffffe6, 0.7));
}

//////////////////////////////////////////////////////////////////////
// Clients 👫
//////////////////////////////////////////////////////////////////////

// add a client meshes, a video element and  canvas for three.js video texture
function addPeer(id) {
    // let videoElement = document.getElementById(id + "_video");
    // let videoTexture = new THREE.VideoTexture(videoElement);
    //
        // let videoMaterial = new THREE.MeshBasicMaterial({
            //   map: videoTexture,
            //   overdraw: true,
            //   side: THREE.DoubleSide,
            // });
    let otherMat = new THREE.MeshNormalMaterial();

    let head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
        otherMat,
        otherMat,
        otherMat,
        otherMat,
        otherMat,
        otherMat,
    ]);

    // set position of head before adding to parent object
    head.position.set(0, 0, 0);

    // https://threejs.org/docs/index.html#api/en/objects/Group
    var group = new THREE.Group();
    group.add(head);

    // add group to scene
    scene.add(group);

    
    // add existing points 
    console.log("La longueur du tableau positions est :", positions.length);
    // add existing points
    pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    // Si les points n'ont pas encore été ajoutés à la scène, les ajouter
    if (!scene.getObjectByName("points")) {
        const points = new THREE.Points(pointsGeometry, pointsMaterial);
        points.name = "points";  // Nommer l'objet pour le retrouver facilement
        scene.add(points);
    }


    peers[id] = {};
    peers[id].group = group;

    // partie pour lisser les mouvements des autres
    peers[id].previousPosition = new THREE.Vector3();
    peers[id].previousRotation = new THREE.Quaternion();
    peers[id].desiredPosition = new THREE.Vector3();
    peers[id].desiredRotation = new THREE.Quaternion();
}

function removePeer(id) {
  scene.remove(peers[id].group);
}

// overloaded function can deal with new info or not
function updatePeerPositions(positions) {
  lerpValue = 0;
  for (let id in positions) {
    if (!peers[id]) continue;
    peers[id].previousPosition.copy(peers[id].group.position);
    peers[id].previousRotation.copy(peers[id].group.quaternion);
    peers[id].desiredPosition = new THREE.Vector3().fromArray(
      positions[id].position
    );
    peers[id].desiredRotation = new THREE.Quaternion().fromArray(
      positions[id].rotation
    );
  }
}

function interpolatePositions() {
  lerpValue += 0.1; // updates are sent roughly every 1/5 second == 10 frames
  for (let id in peers) {
    if (peers[id].group) {
      peers[id].group.position.lerpVectors(
        peers[id].previousPosition,
        peers[id].desiredPosition,
        lerpValue
      );
      peers[id].group.quaternion.slerpQuaternions(
        peers[id].previousRotation,
        peers[id].desiredRotation,
        lerpValue
      );
    }
  }
}

//////////////////////////////////////////////////////////////////////
// Interaction 🤾‍♀️
//////////////////////////////////////////////////////////////////////

function getPlayerPosition() {
  return [
    [camera.position.x, camera.position.y, camera.position.z],
    [
      camera.quaternion._x,
      camera.quaternion._y,
      camera.quaternion._z,
      camera.quaternion._w,
    ],
  ];
}

//////////////////////////////////////////////////////////////////////
// Rendering 🎥
//////////////////////////////////////////////////////////////////////

function update() {
  requestAnimationFrame(() => update());
  frameCount++;

  // if (frameCount % 25 === 0) {
  //   updatePeerVolumes();
  // }

  if (frameCount % 10 === 0) {
    let position = getPlayerPosition();
    communications.sendPosition(position);
  }

  interpolatePositions();

  controls.update();

  renderer.render(scene, camera);
}

//////////////////////////////////////////////////////////////////////
// Event Handlers 🍽
//////////////////////////////////////////////////////////////////////

function onWindowResize(e) {
  let width = window.innerWidth;
  let height = Math.floor(window.innerHeight * 0.9);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function addBox() {
  let msg = {
    type: "box",
    data: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
    },
  };
  communications.sendData(msg);
}

function onNewBox(msg) {
  let geo = new THREE.BoxGeometry(1, 1, 1);
  let mat = new THREE.MeshBasicMaterial();
  let mesh = new THREE.Mesh(geo, mat);

  let pos = msg.data;
  mesh.position.set(pos.x, pos.y, pos.z);

  scene.add(mesh);
}

// pour afficher les points de la database gen par addAllpoint sur un nouveau client
function onNewPoints(msg) {
  const points = msg.data;

  points.forEach(({ x, y, z }) => {
    positions.push(x, y, z);
  });

  pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  if (!scene.getObjectByName("points")) {
    const pointsMesh = new THREE.Points(pointsGeometry, pointsMaterial);
    pointsMesh.name = "points";
    scene.add(pointsMesh);
  }
}

// // Fonction pour gérer les nouveaux points
// function onNewPoints(encodedMsg) {
//   try {
//     // Décoder les données encodées avec msgpack-lite
//     const msg = msgpack.decode(encodedMsg);
//
//     // Vérifier que le type de message est "points"
//     if (msg.type !== "points") {
//       console.warn("Message ignoré : type inconnu", msg.type);
//       return;
//     }
//
//     const points = msg.data;
//
//     // Ajouter chaque point aux positions existantes
//     points.forEach(({ x, y, z }) => {
//       positions.push(x, y, z);
//     });
//
//     // Mettre à jour les positions dans la géométrie
//     pointsGeometry.setAttribute(
//       "position",
//       new THREE.Float32BufferAttribute(positions, 3)
//     );
//
//     // Ajouter le maillage des points à la scène s'il n'existe pas déjà
//     if (!scene.getObjectByName("points")) {
//       const pointsMesh = new THREE.Points(pointsGeometry, pointsMaterial);
//       pointsMesh.name = "points";
//       scene.add(pointsMesh);
//     }
//   } catch (err) {
//     console.error("Erreur lors du décodage des données :", err);
//   }
// }
