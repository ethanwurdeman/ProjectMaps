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

window.toggleArchive = async function(projectId, isActive) {
  await db.collection("projects").doc(projectId).update({ archived: !isActive });
  loadProjectList();
};

window.switchProject = function(projectId) {
  currentProjectId = projectId;
  document.getElementById('projectMenu').style.display = 'none';
  document.getElementById('backBar').style.display = '';
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
  document.getElementById('backBar').style.display = 'none';
  document.getElementById('currentProjectName').textContent = "";
  document.getElementById('segmentList').innerHTML = '';
  Object.values(statusLayers).forEach(layer => layer.clearLayers());
  loadProjectList();
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

  const uniqueId = `submitSegment_${Date.now()}_${Math.floor(Math.random()*10000)}`;
  const popupHtml = `
    <div style="min-width:200px">
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
      <strong>Work Date</strong><br/>
      <input id="workDateInput" type="date" style="width:95%" /><br/>
      <strong>Locate Date</strong><br/>
      <input id="locateDateInput" type="date" style="width:95%" /><br/>
      <strong>Category</strong><br/>
      <select id="categoryInput" style="width:100%">
        <option value="HDD">HDD</option>
        <option value="Plow">Plow</option>
        <option value="Missile">Missile</option>
      </select><br/>
      <button id="${uniqueId}" style="margin-top:6px;width:100%">Submit</button>
    </div>
  `;
  layer.bindPopup(popupHtml).openPopup();

  setTimeout(() => {
    const btn = document.getElementById(uniqueId);
    if (btn) {
      btn.onclick = async () => {
        const ticket = document.getElementById("ticketInput").value;
        const locationVal = document.getElementById("locationInput").value;
        const status = document.getElementById("statusInput").value;
        const workDate = document.getElementById("workDateInput").value;
        const locateDate = document.getElementById("locateDateInput").value;
        const category = document.getElementById("categoryInput").value;

        if (!ticket || !locationVal) {
          alert("Please fill in ticket and location!");
          return;
        }

        let geojsonString;
        try {
          geojsonString = JSON.stringify(geojson);
        } catch (err) {
          alert("GeoJSON could not be stringified!");
          return;
        }

        try {
          await db.collection("segments").add({
            projectId: currentProjectId,
            ticketNumber: ticket,
            location: locationVal,
            status,
            workDate,
            locateDate,
            category,
            geojson: geojsonString,
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
  }, 200);
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
        try {
          geojson = JSON.parse(data.geojson);
        } catch (err) {
          console.error("Invalid GeoJSON", err, data.geojson);
          return;
        }
        if (!geojson.properties) geojson.properties = {};
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
          <strong>Status:</strong> ${data.status}<br/>
          <strong>Work Date:</strong> ${data.workDate || ''}<br/>
          <strong>Locate Date:</strong> ${data.locateDate || ''}<br/>
          <strong>Category:</strong> ${data.category || ''}
        `);
        layersForBounds.push(layer);
      });

      // Fit map to bounds of segments
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

// ==== Segment List in Sidebar, Archive, and Status Update ====

window.toggleArchivedSegments = function() {
  showArchivedSegments = !showArchivedSegments;
  loadSegmentListSidebar();
};

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
    html += `
      <div class="segment-item">
        <div><strong>Ticket:</strong> ${data.ticketNumber}</div>
        <div><strong>Location:</strong> ${data.location}</div>
        <div>
          <strong>Status:</strong>
          <select onchange="window.updateSegmentStatus('${doc.id}', this.value)">
            <option value="Not Located" ${data.status === "Not Located" ? "selected" : ""}>Not Located</option>
            <option value="In Progress" ${data.status === "In Progress" ? "selected" : ""}>In Progress</option>
            <option value="Located" ${data.status === "Located" ? "selected" : ""}>Located</option>
          </select>
        </div>
        <div><strong>Work Date:</strong> ${data.workDate || ''}</div>
        <div><strong>Locate Date:</strong> ${data.locateDate || ''}</div>
        <div><strong>Category:</strong> ${data.category || ''}</div>
        <button onclick="window.toggleSegmentArchive('${doc.id}', ${!data.archived})">
          ${data.archived ? 'Restore' : 'Archive'}
        </button>
      </div>
    `;
  });
  segmentListDiv.innerHTML = html;
}

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
    document.getElementById('backBar').style.display = '';
  } else {
    document.getElementById('projectMenu').style.display = '';
    document.getElementById('backBar').style.display = 'none';
    loadProjectList();
  }
};

// Sidebar slider (centered, modern style)
document.addEventListener("DOMContentLoaded", function() {
  const sidebar = document.getElementById('sidebar');
  const mapDiv = document.getElementById('map');
  const slider = document.getElementById('sidebarSlider');
  let collapsed = false;

  function updateSidebarSlider() {
    if (collapsed) {
      sidebar.style.display = 'none';
      mapDiv.style.marginLeft = '0';
      slider.classList.add('collapsed');
    } else {
      sidebar.style.display = '';
      mapDiv.style.marginLeft = '';
      slider.classList.remove('collapsed');
    }
    setTimeout(() => { 
      if (window.map && window.map.invalidateSize) window.map.invalidateSize();
    }, 300);
  }

  if (slider) {
    slider.onclick = function() {
      collapsed = !collapsed;
      updateSidebarSlider();
    };
    updateSidebarSlider();
  }
});
