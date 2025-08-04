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
let globalConfigFields = [];
let allSegmentsCache = [];
let editingSegmentId = null;

// ==== Filter State ====
let segmentSearchValue = '';
let segmentFilters = {};

// ==== Segment/Sidebar/Map Selection State ====
let segmentLayerMap = {};
let selectedSegmentId = null;

// ==== Config Loader (GLOBAL) ====
// -- TICKET NUMBER & WORK DATE NOW OPTIONAL --
async function loadGlobalConfig() {
  const doc = await db.collection("global").doc("config").get();
  if (doc.exists && doc.data().segmentForm && Array.isArray(doc.data().segmentForm.fields)) {
    globalConfigFields = doc.data().segmentForm.fields;
  } else {
    globalConfigFields = [
      { key:"ticketNumber", type:"text", label:"Ticket #", required:false, show:true },
      { key:"location", type:"text", label:"Location", required:false, show:true },
      { key:"workDate", type:"date", label:"Work Date", required:false, show:true },
      { key:"locateDate", type:"date", label:"Locate Date", required:false, show:true },
      { key:"category", type:"select", label:"Category", options:["HDD","Plow","Missile"], required:false, show:true },
      { key:"status", type:"select", label:"Status", options:["Not Located","In Progress","Located"], required:false, show:true }
    ];
  }
}

// ==== Helper for status badge CSS ====
function statusClass(status) {
  if (!status) return "";
  if (status === "Located") return "segment-status-located";
  if (status === "In Progress") return "segment-status-inprogress";
  if (status === "Not Located") return "segment-status-notlocated";
  return "";
}

// ==== Sidebar <-> Map Segment Selection Logic ====
window.selectSegmentSidebar = function(segmentId) {
  selectedSegmentId = segmentId;
  document.querySelectorAll('.segment-card').forEach(card => card.classList.remove('selected'));
  const el = document.getElementById('sidebar_segment_' + segmentId);
  if (el) el.classList.add('selected');
  if (segmentLayerMap[segmentId]) {
    const l = segmentLayerMap[segmentId];
    try { window.map.fitBounds(l.getBounds().pad(0.3)); } catch {}
    if (typeof l.openPopup === "function") l.openPopup();
    else if (l.getLayers && l.getLayers().length && l.getLayers()[0].openPopup) l.getLayers()[0].openPopup();
  }
};

// ==== Sidebar Dashboard Logic ====
// (unchanged, dashboard summary in loadProjectList below)

window.createProject = async function() {
  const name = document.getElementById("newProjectName").value.trim();
  if (!name) return alert("Project name required.");
  try {
    const ref = await db.collection("projects").add({
      name,
      archived: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    logHistory(ref.id, `Project "${name}" created.`);
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
  logHistory(projectId, `Project deleted.`);
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
  logHistory(projectId, isActive ? "Project archived." : "Project restored.");
  loadProjectList();
};

window.switchProject = function(projectId) {
  closePanels();
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
  closePanels();
  currentProjectId = null;
  document.getElementById('projectMenu').style.display = '';
  document.getElementById('projectHeader').style.display = 'none';
  document.getElementById('currentProjectName').textContent = "";
  document.getElementById('segmentList').innerHTML = '';
  Object.values(statusLayers).forEach(layer => layer.clearLayers());
  loadProjectList();
};

// ==== PROJECT LIST SUMMARY (for dashboard) ====
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
  for (const doc of snap.docs) {
    const data = doc.data();
    // --- Fetch segments for summary counts/feet ---
    let segSnap = await db.collection("segments")
      .where("projectId", "==", doc.id)
      .where("archived", "==", false)
      .get();
    let totalFeet = 0, locatedFeet = 0, notLocatedFeet = 0;
    segSnap.forEach(segDoc => {
      const d = segDoc.data();
      try {
        const geo = JSON.parse(d.geojson);
        const meters = getGeojsonLengthMeters(geo);
        const feet = Math.round(meters * 3.28084);
        totalFeet += feet;
        if (d.status === "Located") locatedFeet += feet;
        else if (d.status === "Not Located") notLocatedFeet += feet;
      } catch {}
    });

    html += `
      <div class="project-item" style="display:flex; align-items:center; justify-content:space-between;">
        <div style="flex:1">
          <span style="font-weight:bold">${data.name}</span><br>
          <small>
            Total: ${totalFeet} ft | Located: ${locatedFeet} ft | Not Located: ${notLocatedFeet} ft
          </small>
        </div>
        <div style="display:flex;gap:4px;">
          <button onclick="switchProject('${doc.id}')">Open</button>
          <button onclick="deleteProject('${doc.id}')">🗑️</button>
          <button onclick="toggleArchiveProject('${doc.id}', ${!data.archived})">
            ${!data.archived ? '📥 Archive' : '📤 Restore'}
          </button>
        </div>
      </div>
    `;
  }
  listDiv.innerHTML = html || "<p>No projects found.</p>";
  updateArchiveBtnLabel();
}

// ==== Map + Segments Logic ====
// --- Define base maps ---
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" });
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "© ESRI Satellite" }
);
const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { attribution: "© OpenTopoMap" });

window.map = L.map("map", {
  center: [41.865, -103.667],
  zoom: 12,
  layers: [osm]
});

// 👇 Add for editing geometry
const drawnItems = new L.FeatureGroup().addTo(window.map);

// --- Define status layers
const statusLayers = {
  "Located": L.layerGroup().addTo(window.map),
  "In Progress": L.layerGroup().addTo(window.map),
  "Not Located": L.layerGroup().addTo(window.map)
};

// --- Layer control with baseMaps and overlays ---
const baseMaps = {
  "Streets": osm,
  "Satellite": satellite,
  "Topo": topo
};
window.layersControl = L.control.layers(baseMaps, {}, { position: 'topleft' }).addTo(window.map);

// --- Draw Controls ---
const drawControl = new L.Control.Draw({
  position: 'topleft',
  edit: { featureGroup: drawnItems },
  draw: {
    polygon: {
      shapeOptions: {
        color: '#e6007a',
        weight: 5,
        opacity: 1
      }
    },
    polyline: {
      shapeOptions: {
        color: '#e6007a',
        weight: 5,
        opacity: 1
      }
    },
    rectangle: false,
    circle: true,
    marker: true,
    circlemarker: true
  }
});
window.map.addControl(drawControl);

// ==== Segment Form: BUILT FROM GLOBAL CONFIG ====
// --- Main "draw complete" handler: ---
window.map.on(L.Draw.Event.CREATED, async function (e) {
  const layer = e.layer;
  drawnItems.addLayer(layer);
  let geojson = layer.toGeoJSON();
  if (!geojson.properties) geojson.properties = {};

  await loadGlobalConfig();
  editingSegmentId = null; // Not editing, this is a new segment

  // --- Length in feet (for polylines/polygons) ---
  let lengthFeet = "";
  if (geojson.geometry.type === "LineString" || geojson.geometry.type === "Polygon") {
    const meters = getGeojsonLengthMeters(geojson);
    lengthFeet = Math.round(meters * 3.28084) + " ft";
  }

  layer.bindPopup(segmentFormHtml(globalConfigFields, {}, lengthFeet)).openPopup();

  // Handle form submit (for NEW segment)
  setTimeout(() => bindSegmentFormSubmit(layer, geojson), 200);
});

// === Edit handler for geometry ===
window.editSegmentGeometry = function(segmentId) {
  // Remove all edit mode
  drawnItems.clearLayers();
  Object.values(segmentLayerMap).forEach(l => { try { l.off('click'); window.map.removeLayer(l); } catch {} });
  // Re-draw just this segment for editing
  db.collection("segments").doc(segmentId).get().then(doc => {
    const data = doc.data();
    let geojson = JSON.parse(data.geojson);
    let layer = L.geoJSON(geojson, {
      style: { color: "#e6007a", weight: 5, opacity: 1 }
    }).addTo(drawnItems);
    window.map.fitBounds(layer.getBounds());
    editingSegmentId = segmentId;
    // --- Show form with existing info
    layer.bindPopup(segmentFormHtml(globalConfigFields, data, getGeojsonLengthFeet(geojson) + " ft", true)).openPopup();
    setTimeout(() => bindSegmentFormSubmit(layer, geojson, segmentId), 200);
  });
};

// --- Build a segment form as HTML (reusable for add/edit) ---
function segmentFormHtml(fields, values, lengthFeet, editing = false) {
  let html = `<form id="segmentForm">`;
  if (lengthFeet) html += `<div><b>Length:</b> ${lengthFeet}</div>`;
  for (const field of fields) {
    if (!field.show) continue;
    const required = field.required ? "required" : "";
    const fieldId = field.key + "Input";
    let val = values[field.key] || "";
    html += `<div style="margin-bottom:6px">`;
    html += `<strong>${field.label}</strong><br/>`;
    if (field.type === "select") {
      html += `<select id="${fieldId}" name="${field.key}" style="width:100%" ${required}>`;
      (field.options || []).forEach(opt => {
        html += `<option value="${opt}" ${val === opt ? "selected" : ""}>${opt}</option>`;
      });
      html += `</select>`;
    } else if (field.type === "date") {
      html += `<input type="date" id="${fieldId}" name="${field.key}" style="width:95%" ${required} value="${val}" />`;
    } else {
      html += `<input type="text" id="${fieldId}" name="${field.key}" style="width:95%" ${required} value="${val}" />`;
    }
    html += `</div>`;
  }
  html += `<button type="submit" style="margin-top:6px;width:100%">${editing ? "Update" : "Submit"}</button>`;
  html += `</form>`;
  return html;
}

// --- Bind form submit for both add/edit ---
function bindSegmentFormSubmit(layer, geojson, segmentId = null) {
  const form = document.getElementById("segmentForm");
  if (!form) return;
  form.onsubmit = async function(ev) {
    ev.preventDefault();
    // Collect values
    const segData = { projectId: currentProjectId, archived: false, geojson: JSON.stringify(geojson), timestamp: firebase.firestore.FieldValue.serverTimestamp() };
    for (const field of globalConfigFields) {
      if (!field.show) continue;
      segData[field.key] = document.getElementById(field.key+"Input").value;
    }
    try {
      if (!segmentId) {
        await db.collection("segments").add(segData);
        logHistory(currentProjectId, `Segment created: ${summaryFromFields(segData)}`);
      } else {
        await db.collection("segments").doc(segmentId).update(segData);
        logHistory(currentProjectId, `Segment updated: ${summaryFromFields(segData)}`);
        editingSegmentId = null;
      }
      loadSegments();
      loadSegmentListSidebar();
      window.map.closePopup();
    } catch (err) {
      alert("❌ Error: " + err.message);
    }
  };
}

// ==== LENGTH (meters, feet) ====
function getGeojsonLengthMeters(geojson) {
  // Polyline: sum distances between coordinates
  let coords = [];
  if (geojson.geometry.type === "LineString") coords = geojson.geometry.coordinates;
  else if (geojson.geometry.type === "Polygon") coords = geojson.geometry.coordinates[0];
  else return 0;
  let m = 0;
  for (let i=1;i<coords.length;i++) {
    m += L.latLng(coords[i-1][1],coords[i-1][0]).distanceTo(L.latLng(coords[i][1],coords[i][0]));
  }
  return m;
}
function getGeojsonLengthFeet(geojson) {
  return Math.round(getGeojsonLengthMeters(geojson) * 3.28084);
}

// ==== Load Segments on Map ====
function segmentStyle(data) {
  return {
    color: data.status === "Located" ? "green" :
           data.status === "In Progress" ? "orange" : "red",
    weight: 4
  };
}

function loadSegments() {
  Object.values(statusLayers).forEach(layer => layer.clearLayers());
  segmentLayerMap = {};
  drawnItems.clearLayers();

  if (!currentProjectId) return;
  db.collection("segments")
    .where("projectId", "==", currentProjectId)
    .where("archived", "==", false)
    .get()
    .then(snap => {
      snap.forEach(doc => {
        const data = doc.data();
        let geojson = {};
        try { geojson = JSON.parse(data.geojson); } catch (err) { return; }
        if (!geojson.properties) geojson.properties = {};

        const layer = L.geoJSON(geojson, { style: segmentStyle(data) }).addTo(statusLayers[data.status || "Not Located"]);
        segmentLayerMap[doc.id] = layer;
        layer.on('click', () => {
          selectSegmentSidebar(doc.id);
          // Popup with details + EDIT BUTTON
          let popupHtml = "";
          for (const field of globalConfigFields) {
            if (data[field.key] !== undefined && field.show) {
              if (field.key === "status") {
                popupHtml += `<div><strong>${field.label}:</strong>
                  <select id="popupStatus_${doc.id}" name="${field.key}">
                    ${(field.options||[]).map(opt
