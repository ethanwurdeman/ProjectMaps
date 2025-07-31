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
let allSegmentsCache = []; // Used for fast sidebar filtering

// ==== Filter State ====
let segmentSearchValue = '';
let segmentFilters = {};

// ==== Segment/Sidebar/Map Selection State ====
let segmentLayerMap = {};
let selectedSegmentId = null;

// ==== Config Loader (GLOBAL) ====
async function loadGlobalConfig() {
  const doc = await db.collection("global").doc("config").get();
  if (doc.exists && doc.data().segmentForm && Array.isArray(doc.data().segmentForm.fields)) {
    globalConfigFields = doc.data().segmentForm.fields;
  } else {
    globalConfigFields = [
      { key:"ticketNumber", type:"text", label:"Ticket #", required:true, show:true },
      { key:"location", type:"text", label:"Location", required:true, show:true },
      { key:"workDate", type:"date", label:"Work Date", required:false, show:true },
      { key:"locateDate", type:"date", label:"Locate Date", required:false, show:true },
      { key:"category", type:"select", label:"Category", options:["HDD","Plow","Missile"], required:false, show:true },
      { key:"status", type:"select", label:"Status", options:["Not Located","In Progress","Located"], required:true, show:true }
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
  // Highlight sidebar card
  document.querySelectorAll('.segment-card').forEach(card => card.classList.remove('selected'));
  const el = document.getElementById('sidebar_segment_' + segmentId);
  if (el) el.classList.add('selected');
  // Zoom to and open popup on map
  if (segmentLayerMap[segmentId]) {
    const l = segmentLayerMap[segmentId];
    try {
      window.map.fitBounds(l.getBounds().pad(0.3));
    } catch {}
    if (typeof l.openPopup === "function") l.openPopup();
    else if (l.getLayers && l.getLayers().length && l.getLayers()[0].openPopup) l.getLayers()[0].openPopup();
  }
};

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
// --- Define base maps ---
const osm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" });
const satellite = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { attribution: "© ESRI Satellite" }
);
const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { attribution: "© OpenTopoMap" });

// --- Add default base map to map (OSM) ---
window.map = L.map("map", {
  center: [41.865, -103.667],
  zoom: 10,
  layers: [osm]
});

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
  edit: false,
  draw: {
    polygon: true,
    polyline: true,
    rectangle: false,
    circle: false,
    marker: true,
    circlemarker: false
  }
});
window.map.addControl(drawControl);

// ==== Segment Form: BUILT FROM GLOBAL CONFIG ====
window.map.on(L.Draw.Event.CREATED, async function (e) {
  const layer = e.layer;
  let geojson = layer.toGeoJSON();
  if (!geojson.properties) geojson.properties = {};

  await loadGlobalConfig();

  const uniqueId = `submitSegment_${Date.now()}_${Math.floor(Math.random()*10000)}`;
  let popupHtml = `<form id="segmentForm">`;
  for (const field of globalConfigFields) {
    if (!field.show) continue;
    const required = field.required ? "required" : "";
    const fieldId = field.key + "Input";
    popupHtml += `<div style="margin-bottom:6px">`;
    popupHtml += `<strong>${field.label}</strong><br/>`;
    if (field.type === "select") {
      popupHtml += `<select id="${fieldId}" name="${field.key}" style="width:100%" ${required}>`;
      (field.options || []).forEach(opt => {
        popupHtml += `<option value="${opt}">${opt}</option>`;
      });
      popupHtml += `</select>`;
    } else if (field.type === "date") {
      popupHtml += `<input type="date" id="${fieldId}" name="${field.key}" style="width:95%" ${required} />`;
    } else {
      popupHtml += `<input type="text" id="${fieldId}" name="${field.key}" style="width:95%" ${required} />`;
    }
    popupHtml += `</div>`;
  }
  popupHtml += `<button type="submit" id="${uniqueId}" style="margin-top:6px;width:100%">Submit</button>`;
  popupHtml += `</form>`;

  layer.bindPopup(popupHtml).openPopup();

  setTimeout(() => {
    const form = document.getElementById("segmentForm");
    if (form) {
      form.onsubmit = async function(ev) {
        ev.preventDefault();
        const segData = { projectId: currentProjectId, archived: false, geojson: JSON.stringify(geojson), timestamp: firebase.firestore.FieldValue.serverTimestamp() };
        for (const field of globalConfigFields) {
          if (!field.show) continue;
          const val = document.getElementById(field.key+"Input").value;
          if (field.required && !val) return alert(`Field "${field.label}" is required.`);
          segData[field.key] = val;
        }
        try {
          await db.collection("segments").add(segData);
          logHistory(currentProjectId, `Segment created: ${summaryFromFields(segData)}`);
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

function summaryFromFields(obj) {
  let txt = [];
  for (const field of globalConfigFields) {
    if (field.key && obj[field.key] && field.show) {
      txt.push(`${field.label}: ${obj[field.key]}`);
    }
  }
  return txt.join(" / ");
}

// ==== Load Segments on Map ====
function segmentStyle(data) {
  // Helper for coloring by status
  return {
    color: data.status === "Located" ? "green" :
           data.status === "In Progress" ? "orange" : "red",
    weight: 4
  };
}

function loadSegments() {
  Object.values(statusLayers).forEach(layer => layer.clearLayers());
  segmentLayerMap = {};

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

        const layer = L.geoJSON(geojson, { style: segmentStyle(data) }).addTo(statusLayers[data.status || "Not Located"]);
        segmentLayerMap[doc.id] = layer;
        layer.on('click', () => {
          selectSegmentSidebar(doc.id);
          layer.openPopup();
        });

        let popupHtml = "";
        for (const field of globalConfigFields) {
          if (data[field.key] !== undefined && field.show) {
            if (field.key === "status") {
              popupHtml += `<div><strong>${field.label}:</strong>
                <select id="popupStatus_${doc.id}" name="${field.key}">
                  ${(field.options||[]).map(opt => `<option value="${opt}" ${data.status === opt ? "selected" : ""}>${opt}</option>`).join("")}
                </select>
                <button onclick="window.updateSegmentStatus('${doc.id}', document.getElementById('popupStatus_${doc.id}').value)">Save</button>
              </div>`;
            } else {
              popupHtml += `<div><strong>${field.label}:</strong> ${data[field.key]}</div>`;
            }
          }
        }
        popupHtml += `<button style="margin-top:8px;color:red" onclick="window.deleteSegment('${doc.id}')">🗑️ Delete Segment</button>`;
        layer.bindPopup(popupHtml);

        layersForBounds.push(layer);
      });
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

// ==== Segment List in Sidebar (Card layout, highlight sync, filter/search) ====
// Track which segment cards are expanded
let expandedSegments = {};

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

  let html = `
    <h3 style="display:inline">Segments</h3>
    <button onclick="toggleArchivedSegments()" style="float:right;">
      ${showArchivedSegments ? 'Show Active' : 'Show Archived'}
    </button>
    <div style="clear:both"></div>
    <div style="margin-bottom:8px;">
      <input type="text" id="sidebarSegmentSearch" placeholder="Search..." style="width:57%;" value="${segmentSearchValue || ""}">
  `;
  globalConfigFields.filter(f => f.type === "select").forEach(f => {
    html += `
      <select id="sidebarFilter_${f.key}" style="margin-left:4px;">
        <option value="">All ${f.label}</option>
        ${(f.options||[]).map(opt => `<option value="${opt}"${segmentFilters[f.key]===opt ? " selected" : ""}>${opt}</option>`).join("")}
      </select>
    `;
  });
  html += `</div>`;

  if (snap.empty) {
    html += "<em>No segments yet.</em>";
    segmentListDiv.innerHTML = html;
    return;
  }

  snap.forEach(doc => {
    const data = doc.data();
    const segmentId = doc.id;

    // --- Filter logic ---
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

    // ---- Render segment card ----
    html += `
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
          ${data.workDate ? `<div><b>Work Date:</b> ${data.workDate}</div>` : ""}
        </div>
        ${expandedSegments[segmentId] ? `
          <div class="segment-extra-details" style="margin-top:8px; border-top:1px solid #ddd; padding-top:6px;">
            ${globalConfigFields.map(f =>
              f.show ? "" : `<div><b>${f.label}:</b> ${data[f.key] || ""}</div>`
            ).join("")}
            ${globalConfigFields.filter(f => f.show).map(f =>
              `<div><b>${f.label}:</b> ${data[f.key] || ""}</div>`
            ).join("")}
          </div>
        ` : ""}
      </div>
    `;
  });

  segmentListDiv.innerHTML = html;

  // ---- Attach handlers to filter/search fields ----
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

// Toggle expand/collapse for a segment card
window.toggleSegmentExpand = function(segmentId) {
  expandedSegments[segmentId] = !expandedSegments[segmentId];
  loadSegmentListSidebar();
}


// ==== Archive Toggle for Segments ====
window.toggleArchivedSegments = function() {
  showArchivedSegments = !showArchivedSegments;
  loadSegmentListSidebar();
};

// ==== Update status, archive, and delete ====
window.updateSegmentStatus = async function(segmentId, newStatus) {
  await db.collection("segments").doc(segmentId).update({ status: newStatus });
  const doc = await db.collection("segments").doc(segmentId).get();
  logHistory(currentProjectId, `Segment status updated: ${summaryFromFields(doc.data())}`);
  loadSegments();
  loadSegmentListSidebar();
};

window.toggleSegmentArchive = async function(segmentId, archiveVal) {
  await db.collection("segments").doc(segmentId).update({ archived: archiveVal });
  const doc = await db.collection("segments").doc(segmentId).get();
  logHistory(currentProjectId, archiveVal ? `Segment archived: ${summaryFromFields(doc.data())}` : `Segment restored: ${summaryFromFields(doc.data())}`);
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
function closePanels() {
  document.getElementById('messagesPanel').style.display = 'none';
  document.getElementById('historyPanel').style.display = 'none';
  document.getElementById('segmentList').style.display = '';
}
window.showSegments = function() {
  document.getElementById('messagesPanel').style.display = 'none';
  document.getElementById('historyPanel').style.display = 'none';
  document.getElementById('segmentList').style.display = '';
};

function renderMessagesPanel() {
  if (!currentProjectId) return;
  const div = document.getElementById('messagesPanel');
  div.innerHTML = `
    <button class="panel-close-btn" onclick="closePanels()" title="Close">&times;</button>
    <h3>💬 Messages</h3>
    <div id="chatMessages"></div>
    <textarea id="newMsg" rows="2" style="width:98%" placeholder="Type message..."></textarea>
    <button onclick="sendMessage()" style="margin-top:3px;width:50%;">Send</button>
  `;
  loadMessages();
}

function renderHistoryPanel() {
  if (!currentProjectId) return;
  const div = document.getElementById('historyPanel');
  div.innerHTML = `
    <button class="panel-close-btn" onclick="closePanels()" title="Close">&times;</button>
    <h3>📜 Project History</h3>
    <div id="historyLog"></div>
  `;
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
        html += `<div style="margin-bottom:4px;"><span style="color:#1976d2"><strong>${m.user||'User'}:</strong></span> ${m.text}</div>`;
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
    user: "User", // TODO: Replace with actual username if available
    timestamp: firebase.firestore.FieldValue.serverTimestamp()
  });
  document.getElementById('newMsg').value = '';
}

function loadHistory() {
  if (!currentProjectId) return;
  db.collection("projects").doc(currentProjectId).collection("history").orderBy("timestamp")
    .get().then(snap => {
      const div = document.getElementById('historyLog');
      let html = '';
      snap.forEach(doc => {
        const h = doc.data();
        html += `<div><strong>[${(h.timestamp&&h.timestamp.toDate().toLocaleString())||''}]</strong> ${h.event}</div>`;
      });
      div.innerHTML = html || '<em>No history yet.</em>';
    });
}

function logHistory(projectId, eventText) {
  if (!projectId) return;
  db.collection("projects").doc(projectId).collection("history").add({
    event: eventText,
    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    user: "User"
  });
}

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
