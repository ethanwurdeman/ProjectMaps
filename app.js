// Firebase Initialization
const firebaseConfig = {
  apiKey: "AIzaSyBizMeB33zvk5Qr9JcE2AJNmx2sr8PnEyk",
  authDomain: "projectmap-35a69.firebaseapp.com",
  projectId: "projectmap-35a69",
  storageBucket: "projectmap-35a69.appspot.com",
  messagingSenderId: "676439686152",
  appId: "1:676439686152:web:0fdc2d8aab41aec67fa5bd"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();

// Get projectId from URL
const urlParams = new URLSearchParams(window.location.search);
let projectId = urlParams.get("projectId");

// Initialize map
const map = L.map("map").setView([41.865, -103.667], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
const drawnItems = new L.FeatureGroup().addTo(map);

const statusLayers = {
  "Not Located": new L.FeatureGroup().addTo(map),
  "In Progress": new L.FeatureGroup().addTo(map),
  "Located": new L.FeatureGroup().addTo(map)
};
L.control.layers(null, statusLayers).addTo(map);

const drawControl = new L.Control.Draw({
  edit: { featureGroup: drawnItems },
  draw: {
    polygon: true,
    polyline: true,
    rectangle: false,
    circle: false,
    marker: false
  }
});
map.addControl(drawControl);

// Draw event
map.on(L.Draw.Event.CREATED, function (e) {
  const layer = e.layer;
  const geojson = layer.toGeoJSON();

  const popup = document.createElement("div");
  popup.innerHTML = `
    <strong>Ticket Number</strong><br/>
    <input id="ticketInput" /><br/>
    <strong>Location</strong><br/>
    <input id="locationInput" /><br/>
    <strong>Status</strong><br/>
    <select id="statusInput">
      <option value="Not Located">Not Located</option>
      <option value="In Progress">In Progress</option>
      <option value="Located">Located</option>
    </select><br/>
    <button id="submitSegment">Submit</button>
  `;

  layer.bindPopup(popup).openPopup();
  popup.querySelector("#submitSegment").onclick = async () => {
    const ticket = popup.querySelector("#ticketInput").value;
    const locationVal = popup.querySelector("#locationInput").value;
    const status = popup.querySelector("#statusInput").value;

    try {
      await db.collection("segments").add({
        projectId,
        ticketNumber: ticket,
        location: locationVal,
        status,
        geojson,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      alert("✅ Segment saved!");
      location.reload();
    } catch (err) {
      alert("❌ Error: " + err.message);
    }
  };
});

// Load segments
async function loadSegments() {
  if (!projectId) return;
  const snapshot = await db.collection("segments").where("projectId", "==", projectId).get();
  snapshot.forEach(doc => {
    const data = doc.data();
    const layer = L.geoJSON(data.geojson, {
      style: {
        color: data.status === "Located" ? "green" :
               data.status === "In Progress" ? "orange" : "red",
        weight: 4
      }
    }).addTo(statusLayers[data.status]);
    layer.bindPopup(`
      <strong>Ticket:</strong> ${data.ticketNumber}<br/>
      <strong>Location:</strong> ${data.location}<br/>
      <strong>Status:</strong> ${data.status}
    `);
  });
}

// Sidebar logic
document.getElementById("toggleSidebar").onclick = () => {
  document.getElementById("sidebar").classList.toggle("collapsed");
};

document.getElementById("createProjectBtn").onclick = async () => {
  const name = prompt("New project name:");
  if (!name) return;

  try {
    const ref = await db.collection("projects").add({
      name,
      archived: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdBy: "dev_user"
    });
    alert("✅ Project created");
    loadProjects();
  } catch (err) {
    alert("❌ Error: " + err.message);
  }
};

async function loadProjects() {
  const list = document.getElementById("projectList");
  list.innerHTML = "";

  const showArchived = document.getElementById("showArchived").checked;
  const query = db.collection("projects").where("archived", "==", showArchived);
  const snapshot = await query.get();

  snapshot.forEach(doc => {
    const div = document.createElement("div");
    div.className = "projectRow";
    div.innerHTML = `
      <button onclick="openProject('${doc.id}')">Open</button>
      <span>${doc.data().name}</span>
      <button onclick="deleteProject('${doc.id}')">🗑️</button>
      <button onclick="archiveProject('${doc.id}', ${!showArchived})">${showArchived ? "Unarchive" : "Archive"}</button>
    `;
    list.appendChild(div);
  });
}

function openProject(id) {
  window.location.href = `map.html?projectId=${id}`;
}

async function deleteProject(id) {
  if (!confirm("Are you sure you want to delete this project?")) return;
  await db.collection("projects").doc(id).delete();
  loadProjects();
}

async function archiveProject(id, archive) {
  await db.collection("projects").doc(id).update({ archived: archive });
  loadProjects();
}

document.getElementById("showArchived").onchange = loadProjects;

// Auth bypass for now
auth.onAuthStateChanged(user => {
  // Proceed regardless of auth for now
  loadProjects();
  if (projectId) loadSegments();
});
