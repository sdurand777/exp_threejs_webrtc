
const express = require('express');
const path = require('path');
const cors = require('cors'); // Importer le middleware CORS
const msgpack = require('msgpack-lite');
const app = express();

// Activer les en-têtes CORS pour toutes les routes
app.use(cors());

// Serve static files from the 'public/dist' directory
app.use(express.static(path.join(__dirname, 'public/dist')));

// Route to serve the index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/dist', 'index.html'));
});

// Start the server
const port = 3000;
const host = '0.0.0.0'; // Listen on all network interfaces
const server = app.listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
  console.log("Accessible depuis d'autres appareils sur le réseau.");
});


// We will use the socket.io library to manage Websocket connections
const io = require("socket.io")().listen(server);

// add the database application 'nedb'
const Datastore = require("nedb");
// create our database and save it to a local file
const db = new Datastore({ filename: "mydatabase.json", autoload: true });

// We will use this object to store information about active peers
let peers = {};

function main() {
  setupSocketServer();

  // periodically update all peers with their positions
  setInterval(function () {
    io.sockets.emit("positions", peers);
  }, 100);
}

main();


// socket server pour gerer les connections
function setupSocketServer() {
  // Set up each socket connection
  io.on("connection", (socket) => {
    console.log(
      "Peer joined with ID",
      socket.id,
      ". There are " + io.engine.clientsCount + " peer(s) connected."
    );

    // add a new peer indexed by their socket id
    peers[socket.id] = {
      position: [0, 0.5, 0],
      rotation: [0, 0, 0, 1], // stored as XYZW values of Quaternion
    };

    // send the new peer a list of all other peers
    socket.emit("introduction", Object.keys(peers));

    // also give the peer all existing peers positions:
    socket.emit("userPositions", peers);

    // also give them existing data in the database
    db.find({}, (err, docs) => {
      if (err) return;
      for (let i = 0; i < docs.length; i++) {
        let doc = docs[i];
        socket.emit("data", doc);
      }
    });


    // db.find({}, (err, docs) => {
    //   if (err) {
    //     console.error("Erreur lors de la récupération des données :", err);
    //     return;
    //   }
    //
    //   // Pour chaque document, encoder les données avec msgpack
    //   for (let i = 0; i < docs.length; i++) {
    //     let doc = docs[i];
    //
    //     // Encoder les données avec msgpack
    //     const encodedDoc = msgpack.encode(doc);
    //
    //     // Envoyer les données encodées via WebSocket
    //     socket.emit("data", encodedDoc);
    //   }
    // });


    // tell everyone that a new user connected
    io.emit("peerConnection", socket.id);

    // whenever the peer moves, update their movements in the peers object
    socket.on("move", (data) => {
      if (peers[socket.id]) {
        peers[socket.id].position = data[0];
        peers[socket.id].rotation = data[1];
      }
    });

    // setup a generic ping-pong which can be used to share arbitrary info between peers
    socket.on("data", (data) => {
      // // insert data into the database
      // db.insert(data);

      // Décoder les données avant de les insérer dans la base
      const decodedData = msgpack.decode(new Uint8Array(data));
      db.insert(decodedData); // Stocker l'objet JSON dans la base


      // then send it to all peers
      io.sockets.emit("data", data);
    });

    // Relay simple-peer signals back and forth
    socket.on("signal", (to, from, data) => {
      if (to in peers) {
        io.to(to).emit("signal", to, from, data);
      } else {
        console.log("Peer not found!");
      }
    });

    // handle disconnections
    socket.on("disconnect", () => {
      delete peers[socket.id];
      io.sockets.emit("peerDisconnection", socket.id);
      console.log(
        "Peer " +
          socket.id +
          " diconnected, there are " +
          io.engine.clientsCount +
          " peer(s) connected."
      );
    });
  });
}
