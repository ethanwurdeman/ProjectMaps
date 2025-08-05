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

firebase.auth().onAuthStateChanged(async user => {
  if (!user) window.location.href = "login.html";
  const userDoc = await db.collection('users').doc(user.uid).get();
  window.currentUser = userDoc.data();
});


// ==== Utility and State ====
let currentProjectId = null;
let showArchived = false;
let showArchivedSegments = false;
let globalConfigFields = [];
let editingSegmentId = null;
let segmentSearchValue = '';
let segmentFilters = {};
let segmentLayerMap = {};
let selectedSegmentId = null;
let expandedSegments = {};

// ==== Load global config ====
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
function closePanels() {
  document.getElementById('messagesPanel').style.display = 'none';
  document.getElementById('historyPanel').style.display = 'none';
  document.getElementById('segmentList').style.display = '';
}

function statusClass(status) {
  if (!status) return "";
  if (status === "Located") return "segment-status-located";
  if (status === "In Progress") return "segment-status-inprogress";
  if (status === "Not Located") return "segment-status-notlocated";
  return "";
}
function segmentStyle(data) {
  return {
    color: data.status === "Located" ? "green"
         : data.status === "In Progress" ? "orange"
         : "red",
    weight: 4
  };
}

// ==== Sidebar <-> Map Segment Selection Logic ====
window.selectSegmentSidebar = function(segmentId) {
  selectedSegmentId = segmentId;
  // Highlight sidebar card
  document.querySelectorAll('.segment-card').forEach(card => card.classList.remove('selected'));
  const el = document.getElementById('sidebar_segment_' + segmentId);
  if (el) el.classList.add('selected');

  // --- SNAP TO MAP LAYER! ---
  if (segmentLayerMap[segmentId]) {
    const l = segmentLayerMap[segmentId];
    // Try to zoom to the bounds
    try {
      if (typeof l.getBounds === "function") {
        window.map.fitBounds(l.getBounds().pad(0.3)); // this is the zoom!
      } else if (l.getLayers && l.getLayers().length && l.getLayers()[0].getBounds) {
        window.map.fitBounds(l.getLayers()[0].getBounds().pad(0.3));
      }
    } catch (e) {}
    // Open popup
    if (typeof l.openPopup === "function") l.openPopup();
    else if (l.getLayers && l.getLayers().length && l.getLayers()[0].openPopup) l.getLayers()[0].openPopup();
  }
};


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
logHistory(projectId, "Project deleted.");
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
}


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
window.openMessages = function() {
  document.getElementById('messagesPanel').style.display = 'block';
  document.getElementById('historyPanel').style.display = 'none';
  document.getElementById('segmentList').style.display = 'none';
  renderMessagesPanel();
};

window.openHistory = function() {
  document.getElementById('messagesPanel').style.display = 'none';
  document.getElementById('historyPanel').style.display = 'block';
  document.getElementById('segmentList').style.display = 'none';
  renderHistoryPanel();
};

window.showSegments = function() {
  document.getElementById('messagesPanel').style.display = 'none';
  document.getElementById('historyPanel').style.display = 'none';
  document.getElementById('segmentList').style.display = '';
};

// ==== Project List with Dashboard Summary ====
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

  listDiv.innerHTML = html || "<p>No projects found.</p>";
  updateArchiveBtnLabel();
}

// ==== Map + Segments Logic ====
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
const drawnItems = new L.FeatureGroup().addTo(window.map);

const statusLayers = {
  "Located": L.layerGroup().addTo(window.map),
  "In Progress": L.layerGroup().addTo(window.map),
  "Not Located": L.layerGroup().addTo(window.map)
};

const baseMaps = {
  "Streets": osm,
  "Satellite": satellite,
  "Topo": topo
};
window.layersControl = L.control.layers(baseMaps, {}, { position: 'topleft' }).addTo(window.map);

const drawControl = new L.Control.Draw({
  position: 'topleft',
  edit: { featureGroup: drawnItems },
  draw: {
    polygon: {
      shapeOptions: { color: '#e6007a', weight: 5, opacity: 1 }
    },
    polyline: {
      shapeOptions: { color: '#e6007a', weight: 5, opacity: 1 }
    },
    rectangle: false,
    circle: true,
    marker: true,
    circlemarker: true
  }
});
window.map.addControl(drawControl);

// ==== Segment Length Helpers ====
function getGeojsonLengthMeters(geojson) {
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

// ==== Segment Form (Add/Edit) ====
function segmentFormHtml(fields, values, lengthFeet, editing = false) {
let html = `<form id="segmentForm">`;
if (lengthFeet) html += `<div><b>Length:</b> ${lengthFeet}</div>`;
  for (const field of fields) {
    if (!field.show) continue;
    const required = field.required ? "required" : "";
    const fieldId = field.key + "Input";
    let val = values[field.key] || "";
    html += <div style="margin-bottom:6px">;
    html += <strong>${field.label}</strong><br/>;
    if (field.type === "select") {
      html += <select id="${fieldId}" name="${field.key}" style="width:100%" ${required}>;
      (field.options || []).forEach(opt => {
        html += <option value="${opt}" ${val === opt ? "selected" : ""}>${opt}</option>;
      });
      html += </select>;
    } else if (field.type === "date") {
      html += <input type="date" id="${fieldId}" name="${field.key}" style="width:95%" ${required} value="${val}" />;
    } else {
      html += <input type="text" id="${fieldId}" name="${field.key}" style="width:95%" ${required} value="${val}" />;
    }
    html += </div>;
  }
  html += <button type="submit" style="margin-top:6px;width:100%">${editing ? "Update" : "Submit"}</button>;
  html += </form>;
  return html;
}

// ==== Drawing a new segment (create) ====
window.map.on(L.Draw.Event.CREATED, async function (e) {
  const layer = e.layer;
  drawnItems.addLayer(layer);
  let geojson = layer.toGeoJSON();
  if (!geojson.properties) geojson.properties = {};
  await loadGlobalConfig();
  editingSegmentId = null;
  let lengthFeet = "";
  if (geojson.geometry.type === "LineString" || geojson.geometry.type === "Polygon") {
    const meters = getGeojsonLengthMeters(geojson);
    lengthFeet = Math.round(meters * 3.28084) + " ft";
  }
  layer.bindPopup(segmentFormHtml(globalConfigFields, {}, lengthFeet)).openPopup();
  setTimeout(() => bindSegmentFormSubmit(layer, geojson), 200);
});

// ==== Edit segment geometry/info ====
window.editSegmentGeometry = function(segmentId) {
  drawnItems.clearLayers();
  Object.values(segmentLayerMap).forEach(l => { try { l.off('click'); window.map.removeLayer(l); } catch {} });
  db.collection("segments").doc(segmentId).get().then(doc => {
    const data = doc.data();
    let geojson = JSON.parse(data.geojson);
    let layer = L.geoJSON(geojson, { style: { color: "#e6007a", weight: 5, opacity: 1 } }).addTo(drawnItems);
    window.map.fitBounds(layer.getBounds());
    editingSegmentId = segmentId;
    layer.bindPopup(segmentFormHtml(globalConfigFields, data, getGeojsonLengthFeet(geojson) + " ft", true)).openPopup();
    setTimeout(() => bindSegmentFormSubmit(layer, geojson, segmentId), 200);
  });
};

function bindSegmentFormSubmit(layer, geojson, segmentId = null) {
  const form = document.getElementById("segmentForm");
  if (!form) return;
  form.onsubmit = async function(ev) {
    ev.preventDefault();
    const segData = { projectId: currentProjectId, archived: false, geojson: JSON.stringify(geojson), timestamp: firebase.firestore.FieldValue.serverTimestamp() };
    for (const field of globalConfigFields) {
      if (!field.show) continue;
      segData[field.key] = document.getElementById(field.key+"Input").value;
    }
    try {
      if (!segmentId) {
        await db.collection("segments").add(segData);
        logHistory(currentProjectId, Segment created: ${summaryFromFields(segData)});
      } else {
        await db.collection("segments").doc(segmentId).update(segData);
        logHistory(currentProjectId, Segment updated: ${summaryFromFields(segData)});
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

// ==== Load Segments on Map ====
let segmentsUnsubscribe = null;

function loadSegments() {
  // Remove previous listener if present
  if (typeof segmentsUnsubscribe === "function") segmentsUnsubscribe();

  Object.values(statusLayers).forEach(layer => layer.clearLayers());
  segmentLayerMap = {};
  drawnItems.clearLayers();
  if (!currentProjectId) return;

  // Listen for changes!
  segmentsUnsubscribe = db.collection("segments")
    .where("projectId", "==", currentProjectId)
    .where("archived", "==", false)
    .onSnapshot(snap => {
      Object.values(statusLayers).forEach(layer => layer.clearLayers());
      segmentLayerMap = {};
      drawnItems.clearLayers();
      const layersForBounds = [];
      snap.forEach(doc => {
        const data = doc.data();
        let geojson = {};
        try { geojson = JSON.parse(data.geojson); } catch (err) { return; }
        if (!geojson.properties) geojson.properties = {};

        const layer = L.geoJSON(geojson, { style: segmentStyle(data) }).addTo(statusLayers[data.status || "Not Located"]);
        segmentLayerMap[doc.id] = layer;
        layersForBounds.push(layer);
        layer.on('click', () => {
          selectSegmentSidebar(doc.id);
          let popupHtml = "";
          for (const field of globalConfigFields) {
            if (data[field.key] !== undefined && field.show) {
              if (field.key === "status") {
                popupHtml += <div><strong>${field.label}:</strong>
                  <select id="popupStatus_${doc.id}" name="${field.key}">
                    ${(field.options||[]).map(opt => <option value="${opt}" ${data.status === opt ? "selected" : ""}>${opt}</option>).join("")}
                  </select>
                  <button onclick="window.updateSegmentStatus('${doc.id}', document.getElementById('popupStatus_${doc.id}').value)">Save</button>
                </div>;
              } else {
                popupHtml += <div><strong>${field.label}:</strong> ${data[field.key]}</div>;
              }
            }
          }
          popupHtml += <button style="margin-top:8px;color:red" onclick="window.deleteSegment('${doc.id}')">🗑️ Delete Segment</button>;
          popupHtml += <button style="margin-left:8px" onclick="window.editSegmentGeometry('${doc.id}')">✏️ Edit Segment</button>;
          layer.bindPopup(popupHtml).openPopup();
        });
      });

      // Auto-zoom to all loaded segment layers (only on project load)
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


// ==== Segment List in Sidebar (Card layout, expand/collapse, filters/search) ====
async function loadSegmentListSidebar() {
  const segmentListDiv = document.getElementById("segmentList");
  if (!currentProjectId) {
    segmentListDiv.innerHTML = "";
    return;
  }
  await loadGlobalConfig();
  let query = db.collection("segments")
    .where("projectId", "==", currentProjectId)
    .where("archived", "==", !!showArchivedSegments);

  const snap = await query.get();
  segmentLayerMap = {};

  let html = 
    <h3 style="display:inline">Segments</h3>
    <button onclick="toggleArchivedSegments()" style="float:right;">
      ${showArchivedSegments ? 'Show Active' : 'Show Archived'}
    </button>
    <div style="clear:both"></div>
    <div style="margin-bottom:8px;">
      <input type="text" id="sidebarSegmentSearch" placeholder="Search..." style="width:57%;" value="${segmentSearchValue || ""}">
  ;
  globalConfigFields.filter(f => f.type === "select").forEach(f => {
    html += 
      <select id="sidebarFilter_${f.key}" style="margin-left:4px;">
        <option value="">All ${f.label}</option>
        ${(f.options||[]).map(opt => <option value="${opt}"${segmentFilters[f.key]===opt ? " selected" : ""}>${opt}</option>).join("")}
      </select>
    ;
  });
  html += </div>;

  if (snap.empty) {
    html += "<em>No segments yet.</em>";
    segmentListDiv.innerHTML = html;
    return;
  }

  snap.forEach(doc => {
    const data = doc.data();
    const segmentId = doc.id;

    if (segmentSearchValue) {
      let found = false;
      globalConfigFields.forEach(f => {
        if (data[f.key] && data[f.key].toString().toLowerCase().includes(segmentSearchValue.toLowerCase())) found = true;
      });
      if (!found) return;
    }
    for (let key in segmentFilters) {
      if (segmentFilters[key] && data[key] !== segmentFilters[key]) return;
    }

    html += 
      <div class="segment-card${selectedSegmentId === segmentId ? " selected" : ""}" 
        onclick="window.selectSegmentSidebar('${segmentId}')"
        id="sidebar_segment_${segmentId}">
        <div class="segment-title" style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            ${data.ticketNumber || "(No Ticket #)"}
            <span class="segment-status ${statusClass(data.status)}">${data.status || ""}</span>
          </div>
          <button type="button" class="show-more-btn" style="margin-left:8px;" onclick="event.stopPropagation(); window.toggleSegmentExpand('${segmentId}');">
            ${expandedSegments[segmentId] ? "Show Less" : "Show More"}
          </button>
        </div>
        <div class="segment-details">
          <div><b>Location:</b> ${data.location || ""}</div>
          ${data.workDate ? <div><b>Work Date:</b> ${data.workDate}</div> : ""}
        </div>
        ${expandedSegments[segmentId] ? 
          <div class="segment-extra-details" style="margin-top:8px; border-top:1px solid #ddd; padding-top:6px;">
            ${globalConfigFields.filter(f => f.show).map(f =>
              <div><b>${f.label}:</b> ${data[f.key] || ""}</div>
            ).join("")}
            <button onclick="event.stopPropagation(); window.editSegmentGeometry('${segmentId}')" style="margin-top:8px;">✏️ Edit Segment</button>
            <button onclick="event.stopPropagation(); window.deleteSegment('${segmentId}')" style="color:red; margin-left:8px;">🗑️ Delete Segment</button>
          </div>
         : ""}
      </div>
    ;
  });

  segmentListDiv.innerHTML = html;
  setTimeout(() => {
    document.getElementById('sidebarSegmentSearch').oninput = function() {
      segmentSearchValue = this.value;
      loadSegmentListSidebar();
    };
    globalConfigFields.filter(f => f.type === "select").forEach(f => {
      document.getElementById('sidebarFilter_' + f.key).onchange = function() {
        segmentFilters[f.key] = this.value;
        loadSegmentListSidebar();
      };
    });
  }, 0);
}

window.toggleSegmentExpand = function(segmentId) {
  expandedSegments[segmentId] = !expandedSegments[segmentId];
  loadSegmentListSidebar();
}

window.toggleArchivedSegments = function() {
  showArchivedSegments = !showArchivedSegments;
  loadSegmentListSidebar();
};

window.updateSegmentStatus = async function(segmentId, newStatus) {
  await db.collection("segments").doc(segmentId).update({ status: newStatus });
  const doc = await db.collection("segments").doc(segmentId).get();
  logHistory(currentProjectId, Segment status updated: ${summaryFromFields(doc.data())});
  loadSegments();
  loadSegmentListSidebar();
};

window.toggleSegmentArchive = async function(segmentId, archiveVal) {
  await db.collection("segments").doc(segmentId).update({ archived: archiveVal });
  const doc = await db.collection("segments").doc(segmentId).get();
  logHistory(currentProjectId, archiveVal ? Segment archived: ${summaryFromFields(doc.data())} : Segment restored: ${summaryFromFields(doc.data())});
  loadSegments();
  loadSegmentListSidebar();
};

window.deleteSegment = async function(segmentId) {
  if (!confirm("Delete this segment? This cannot be undone.")) return;
  await db.collection("segments").doc(segmentId).delete();
  logHistory(currentProjectId, "Segment deleted.");
  loadSegments();
  loadSegmentListSidebar();
};

// ==== MESSAGES & HISTORY PANEL LOGIC ====
// (Unchanged from your current code. If you need this section again, let me know!)

// Sidebar collapse logic
window.toggleSidebar = function() {
  const sidebar = document.getElementById('sidebar');
  const btn = document.getElementById('collapseBtn');
  sidebar.classList.toggle('collapsed');
  if (sidebar.classList.contains('collapsed')) {
    btn.innerHTML = '&#9654;';
  } else {
    btn.innerHTML = '&#9664;';
  }
}


function renderMessagesPanel() {
  if (!currentProjectId) return;
  const div = document.getElementById('messagesPanel');
  div.innerHTML = 
    <button class="panel-close-btn" onclick="showSegments()" title="Close">&times;</button>
    <h3>💬 Messages</h3>
    <div id="chatMessages"></div>
    <textarea id="newMsg" rows="2" style="width:98%" placeholder="Type message..."></textarea>
    <button onclick="sendMessage()" style="margin-top:3px;width:50%;">Send</button>
  ;
  loadMessages();
}

function renderHistoryPanel() {
  if (!currentProjectId) return;
  const div = document.getElementById('historyPanel');
  div.innerHTML = 
    <button class="panel-close-btn" onclick="showSegments()" title="Close">&times;</button>
    <h3>📜 Project History</h3>
    <div id="historyLog"></div>
  ;
  loadHistory();
}
function loadMessages() {
  if (!currentProjectId) return;
  db.collection("projects").doc(currentProjectId).collection("messages").orderBy("timestamp")
    .onSnapshot(snap => {
      const div = document.getElementById('chatMessages');
      let html = '';
      snap.forEach(doc => {
        const m = doc.data();
        // Format timestamp (if available)
        let ts = "";
        if (m.timestamp && typeof m.timestamp.toDate === "function") {
          const d = m.timestamp.toDate();
          ts = ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})};
        }
        html += 
          <div style="margin-bottom:6px;">
            <span style="color:#1976d2;font-weight:bold;">${m.user || 'User'}</span>
            <span style="color:#999;font-size:0.95em;margin-left:5px;">${ts}</span>
            <br>${m.text}
          </div>;
      });
      div.innerHTML = html || '<em>No messages yet.</em>';
      div.scrollTop = div.scrollHeight;
    });
}
function sendMessage() {
  const val = document.getElementById('newMsg').value.trim();
  if (!val || !currentProjectId) return;
  db.collection("projects").doc(currentProjectId).collection("messages").add({
    text: val,
    user: (window.currentUser && window.currentUser.email) ? window.currentUser.email : "User",
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById('newMsg').value = '';
}

// ==== Initial Load ====
window.onload = async function() {
  await loadGlobalConfig();
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

function summaryFromFields(obj) {
  let txt = [];
  for (const field of globalConfigFields) {
    if (field.key && obj[field.key] && field.show) {
      txt.push(${field.label}: ${obj[field.key]});
    }
  }
  return txt.join(" / ");
}

function logHistory(projectId, eventText) {
  if (!projectId) return;
  db.collection("projects").doc(projectId).collection("history").add({
    event: eventText,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    user: "User"
  });
}
