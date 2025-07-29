// ==== Firebase Initialization ====
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

// ==== Utility ====
let currentProjectId = null;
let showArchived = false;

// ==== Sidebar Dashboard Logic ====

// Attach functions globally so HTML onclick can find them:
window.createProject = async function() {
  const name = document.getElementById("newProjectName").value.trim();
  if (!name) return alert("Project name required.");

  try {
    const ref = await db.collection("projects").add({
      name,
      archived: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    loadProjectList();
    // Switch to new project:
    switchProject(ref.id);
  } catch (e) {
    alert("Error creating project: " + e.message);
  }
};

window.deleteProject = async function(projectId) {
  if (!confirm("Are you sure you want to delete this project?")) return;
  await db.collection("projects").doc(projectId).delete();
  // Remove all segments for this project as well (optional)
  const segments = await db.collection("segments").where("projectId", "==", projectId).get();
  segments.forEach(async (doc) => await db.collection("segments").doc(doc.id).delete());
  loadProjectList();
};

window.toggleArchive = async function(projectId, isActive) {
  await db.collection("projects").doc(projectId).update({ archived: !isActive });
  loadProjectList();
};

window.switchProject = function(projectId) {
  // Reload page with the chosen project:
  window.location.href = `map.html?projectId=${projectId}`;
};

window.toggleArchived = function() {
  showArchived = !showArchived;
  loadProjectList();
};

async function loadProjectList() {
  const listDiv = document.getElementById("projectList");
  listDiv.innerHTML = "<p>Loading...</p>";
  let query = db.collection("projects").orderBy("createdAt", "desc");
  if (showArchived) {
    query = query.where("archived", "==", true);
  } else {
    query = query.where("archived", "==", false);
  }
  const snap = await query.get();

  let html = "";
  snap.forEach(doc => {
    const data = doc.data();
    html += `
      <div class="project-item">
        <button onclick="switchProject('${doc.id}')">Open</button>
        <span style="flex:1">${data.name}</span>
        <button onclick="deleteProject('${doc.id}')">🗑️</button>
        <button onclick="toggleArchive('${doc.id}', ${!data.archived})">
          ${!data.archived ? '📥 Archive' : '📤 Restore'}
        </button>
      </div>
    `;
  });
  listDiv.innerHTML = html || "<p>No projects found.</p>";
}

// ==== Map + Segments Logic ====
const urlParams = new URLSearchParams(window.location.search);
currentProjectId = urlParams.get("projectId");

// Init map
const map = L.map("map").setView([41.865, -103.667], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

// Draw controls
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

// --- FIXED: Draw Event with reliable popup submission ---
map.on(L.Draw.Event.CREATED, function (e) {
  const layer = e.layer;
  let geojson = layer.toGeoJSON();
  if (!geojson.properties) geojson.properties = {};

  drawnItems.addLayer(layer); // always add drawn feature to map

  // Use a unique ID so event handler always attaches to the right popup
  const uniqueId = `submitSegment_${Date.now()}_${Math.floor(Math.random()*10000)}`;
  const popupHtml = `
    <div style="min-width:180px">
      <strong>Ticket #</strong><br/>
      <input id="ticketInput" style="width:95%" /><br/>
      <strong>Location</strong><br/>
      <input id="locationInput" style="width:95%" /><br/>
      <strong>Status</strong><br/>
      <select id="statusInput" style="width:100%">
        <option value="Not Located">Not Located</option>
        <option value="In Progress">In Progress</option>
        <option value="Located">Located</option>
      </select><br/>
      <button id="${uniqueId}" style="margin-top:6px;width:100%">Submit</button>
    </div>
  `;
  layer.bindPopup(popupHtml).openPopup();

  // Wait for the popup to actually exist in the DOM:
  setTimeout(() => {
    const btn = document.getElementById(uniqueId);
    if (btn) {
      btn.onclick = async () => {
        const ticket = document.getElementById("ticketInput").value;
        const locationVal = document.getElementById("locationInput").value;
        const status = document.getElementById("statusInput").value;

        if (!ticket || !locationVal) {
          alert("Please fill in ticket and location!");
          return;
        }

        try {
          await db.collection("segments").add({
            projectId: currentProjectId,
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
    }
  }, 200);
});

async function loadSegments() {
  // Remove previous layers
  Object.values(statusLayers).forEach(layer => layer.clearLayers());
  if (!currentProjectId) return;

  const snap = await db.collection("segments").where("projectId", "==", currentProjectId).get();
  snap.forEach(doc => {
    const data = doc.data();
    let geojson = data.geojson;
    if (!geojson.properties) geojson.properties = {}; // Clean GeoJSON
    const layer = L.geoJSON(geojson, {
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

// ==== Initial Load ====
window.onload = function() {
  loadProjectList();
  if (currentProjectId) {
    loadSegments();
  }
};
