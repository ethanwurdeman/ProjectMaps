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
let showArchivedSegments = false;

// ==== Sidebar Dashboard Logic ====

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
    switchProject(ref.id);
  } catch (e) {
    alert("Error creating project: " + e.message);
  }
};

window.deleteProject = async function(projectId) {
  if (!confirm("Are you sure you want to delete this project?")) return;
  await db.collection("projects").doc(projectId).delete();
  const segments = await db.collection("segments").where("projectId", "==", projectId).get();
  segments.forEach(async (doc) => await db.collection("segments").doc(doc.id).delete());
  loadProjectList();
};

window.toggleArchive = function() {
  showArchived = !showArchived;
  loadProjectList();
  updateArchiveBtnLabel();
};

function updateArchiveBtnLabel() {
  const btn = document.getElementById('archiveToggleBtn');
  if (btn) {
    btn.textContent = showArchived ? "View Active Projects" : "View Archived Projects";
  }
}

window.toggleArchiveProject = async function(projectId, isActive) {
  await db.collection("projects").doc(projectId).update({ archived: !isActive });
  loadProjectList();
};

window.switchProject = function(projectId) {
  currentProjectId = projectId;
  document.getElementById('projectMenu').style.display = 'none';
  document.getElementById('projectHeader').style.display = 'flex';
  db.collection("projects").doc(projectId).get().then(doc => {
    if (doc.exists) {
      document.getElementById("currentProjectName").textContent = doc.data().name;
    } else {
      document.getElementById("currentProjectName").textContent = "Unknown Project";
    }
  });
  loadSegments();
  loadSegmentListSidebar();
};

window.returnToProjectList = function() {
  currentProjectId = null;
  document.getElementById('projectMenu').style.display = '';
  document.getElementById('projectHeader').style.display = 'none';
  document.getElementById('currentProjectName').textContent = "";
  document.getElementById('segmentList').innerHTML = '';
  Object.values(statusLayers).forEach(layer => layer.clearLayers());
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
        <button onclick="toggleArchiveProject('${doc.id}', ${!data.archived})">
          ${!data.archived ? '📥 Archive' : '📤 Restore'}
        </button>
      </div>
    `;
  });
  listDiv.innerHTML = html || "<p>No projects found.</p>";
  updateArchiveBtnLabel();
}

// ==== Map + Segments Logic ====
const urlParams = new URLSearchParams(window.location.search);
currentProjectId = urlParams.get("projectId");

window.map = L.map("map").setView([41.865, -103.667], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(window.map);

const drawnItems = new L.FeatureGroup().addTo(window.map);
const statusLayers = {
  "Not Located": new L.FeatureGroup().addTo(window.map),
  "In Progress": new L.FeatureGroup().addTo(window.map),
  "Located": new L.FeatureGroup().addTo(window.map)
};
L.control.layers(null, statusLayers).addTo(window.map);

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
window.map.addControl(drawControl);

window.map.on(L.Draw.Event.CREATED, function (e) {
  const layer = e.layer;
  let geojson = layer.toGeoJSON();
  if (!geojson.properties) geojson.properties = {};

  drawnItems.addLayer(layer);

  // Simple popup form for segment
  const popupDiv = document.createElement("div");
  popupDiv.innerHTML = `
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
  layer.bindPopup(popupDiv).openPopup();

  setTimeout(() => {
    const btn = popupDiv.querySelector("#submitSegment");
    if (btn) {
      btn.onclick = async () => {
        const ticket = popupDiv.querySelector("#ticketInput").value;
        const locationVal = popupDiv.querySelector("#locationInput").value;
        const status = popupDiv.querySelector("#statusInput").value;

        try {
          await db.collection("segments").add({
            projectId: currentProjectId,
            ticketNumber: ticket,
            location: locationVal,
            status,
            geojson: JSON.stringify(geojson), // Save as string to avoid nested array bug
            archived: false,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
          });
          loadSegments();
          loadSegmentListSidebar();
          window.map.closePopup();
        } catch (err) {
          alert("❌ Error: " + err.message);
        }
      };
    }
  }, 150);
});

function loadSegments() {
  Object.values(statusLayers).forEach(layer => layer.clearLayers());
  if (!currentProjectId) return;
  db.collection("segments")
    .where("projectId", "==", currentProjectId)
    .where("archived", "==", false)
    .get()
    .then(snap => {
      const layersForBounds = [];
      snap.forEach(doc => {
        const data = doc.data();
        let geojson = {};
        try { geojson = JSON.parse(data.geojson); } catch (err) { return; }
        if (!geojson.properties) geojson.properties = {};
        const layer = L.geoJSON(geojson, {
          style: {
            color: data.status === "Located" ? "green" :
                   data.status === "In Progress" ? "orange" : "red",
            weight: 4
          }
        }).addTo(statusLayers[data.status || "Not Located"]);
        layer.bindPopup(`
          <strong>Ticket:</strong> ${data.ticketNumber}<br/>
          <strong>Location:</strong> ${data.location}<br/>
          <strong>Status:</strong> ${data.status}
        `);
        layersForBounds.push(layer);
      });
      // Fit to segments
      if (layersForBounds.length > 0) {
        let bounds = null;
        layersForBounds.forEach(l => {
          try {
            const lb = l.getBounds();
            bounds = bounds ? bounds.extend(lb) : lb;
          } catch { /* skip if marker */ }
        });
        if (bounds && bounds.isValid()) {
          window.map.fitBounds(bounds.pad(0.2));
        }
      }
    });
}

async function loadSegmentListSidebar() {
  const segmentListDiv = document.getElementById("segmentList");
  if (!currentProjectId) {
    segmentListDiv.innerHTML = "";
    return;
  }
  let query = db.collection("segments")
    .where("projectId", "==", currentProjectId)
    .where("archived", "==", !!showArchivedSegments);

  const snap = await query.get();

  let html = `
    <h3 style="display:inline">Segments</h3>
    <button onclick="toggleArchivedSegments()" style="float:right;">
      ${showArchivedSegments ? 'Show Active' : 'Show Archived'}
    </button>
    <div style="clear:both"></div>
  `;

  if (snap.empty) {
    html += "<em>No segments yet.</em>";
    segmentListDiv.innerHTML = html;
    return;
  }

  snap.forEach(doc => {
    const data = doc.data();
    html += `<div class="segment-item">`;
    html += `<div><strong>Ticket #:</strong> ${data.ticketNumber || ""}</div>`;
    html += `<div><strong>Location:</strong> ${data.location || ""}</div>`;
    html += `<div><strong>Status:</strong>
      <select onchange="window.updateSegmentStatus('${doc.id}', this.value)">
        <option value="Not Located" ${data.status === "Not Located" ? "selected" : ""}>Not Located</option>
        <option value="In Progress" ${data.status === "In Progress" ? "selected" : ""}>In Progress</option>
        <option value="Located" ${data.status === "Located" ? "selected" : ""}>Located</option>
      </select>
    </div>`;
    html += `<button onclick="window.toggleSegmentArchive('${doc.id}', ${!data.archived})">
      ${data.archived ? 'Restore' : 'Archive'}
    </button>`;
    html += `</div>`;
  });
  segmentListDiv.innerHTML = html;
}

window.toggleArchivedSegments = function() {
  showArchivedSegments = !showArchivedSegments;
  loadSegmentListSidebar();
};

window.updateSegmentStatus = async function(segmentId, newStatus) {
  await db.collection("segments").doc(segmentId).update({ status: newStatus });
  loadSegments();
  loadSegmentListSidebar();
};

window.toggleSegmentArchive = async function(segmentId, archiveVal) {
  await db.collection("segments").doc(segmentId).update({ archived: archiveVal });
  loadSegments();
  loadSegmentListSidebar();
};

// ==== Initial Load ====
window.onload = function() {
  const urlParams = new URLSearchParams(window.location.search);
  const urlProjectId = urlParams.get("projectId");
  if (urlProjectId) {
    switchProject(urlProjectId);
    document.getElementById('projectMenu').style.display = 'none';
    document.getElementById('projectHeader').style.display = 'flex';
  } else {
    document.getElementById('projectMenu').style.display = '';
    document.getElementById('projectHeader').style.display = 'none';
    loadProjectList();
  }
};
