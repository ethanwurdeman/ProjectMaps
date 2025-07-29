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

// Grab Project ID from URL
const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get("projectId");

// Initialize Map
const map = L.map("map").setView([41.865, -103.667], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);

// Status Layers
const statusLayers = {
  "Not Located": new L.FeatureGroup().addTo(map),
  "In Progress": new L.FeatureGroup().addTo(map),
  "Located": new L.FeatureGroup().addTo(map)
};
L.control.layers(null, statusLayers).addTo(map);

// Draw controls
const drawnItems = new L.FeatureGroup().addTo(map);
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

// Load Segments for Current Project
async function loadSegments() {
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

// Draw Created Event
map.on(L.Draw.Event.CREATED, async function (e) {
  const layer = e.layer;
  const geojson = layer.toGeoJSON();

  const popup = document.createElement("div");
  popup.innerHTML = `
    <strong>Ticket #</strong><br/>
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

// Load Dashboard Sidebar
async function loadSidebar() {
  const container = document.getElementById("sidebar-content");
  const snapshot = await db.collection("projects").get();

  let html = `
    <h3>Projects</h3>
    <input type="text" id="newProjectName" placeholder="New Project Name" />
    <button onclick="createProject()">Create</button>
    <ul>
  `;

  snapshot.forEach(doc => {
    const data = doc.data();
    const isActive = data.archived !== true;
    html += `
      <li>
        <button onclick="switchProject('${doc.id}')">📂</button>
        ${data.name}
        <button onclick="deleteProject('${doc.id}')">🗑</button>
        <button onclick="toggleArchive('${doc.id}', ${isActive})">${isActive ? '📥 Archive' : '📤 Restore'}</button>
      </li>
    `;
  });

  html += "</ul>";
  container.innerHTML = html;
}

window.createProject = async function () {
  const name = document.getElementById("newProjectName").value.trim();
  if (!name) return alert("Project name required");

  try {
    const ref = await db.collection("projects").add({
      name,
      archived: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    window.location.href = `map.html?projectId=${ref.id}`;
  } catch (e) {
    alert("Error creating project: " + e.message);
  }
};

window.deleteProject = async function (projectId) {
  if (confirm("Are you sure you want to delete this project?")) {
    await db.collection("projects").doc(projectId).delete();
    loadSidebar();
  }
};

window.toggleArchive = async function (projectId, currentStatus) {
  await db.collection("projects").doc(projectId).update({ archived: !currentStatus });
  loadSidebar();
};

window.switchProject = function (projectId) {
  window.location.href = `map.html?projectId=${projectId}`;
};

// Initialize everything
window.onload = () => {
  loadSidebar();
  if (projectId) {
    loadSegments();
  }
};
