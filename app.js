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
let globalConfigFields = []; // Loaded once on startup

// ==== Config Loader (GLOBAL) ====
async function loadGlobalConfig() {
  const doc = await db.collection("global").doc("config").get();
  if (doc.exists && doc.data().segmentForm && Array.isArray(doc.data().segmentForm.fields)) {
    globalConfigFields = doc.data().segmentForm.fields;
  } else {
    globalConfigFields = [
      { key:"ticketNumber", type:"text", label:"Ticket #", required:true, show:true },
      { key:"location", type:"text", label:"Location", required:true, show:true },
      { key:"status", type:"select", label:"Status", options:["Not Located","In Progress","Located"], required:true, show:true }
    ];
  }
}

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

window.toggleArchive = async function(projectId, isActive) {
  await db.collection("projects").doc(projectId).update({ archived: !isActive });
  logHistory(projectId, isActive ? "Project archived." : "Project restored.");
  loadProjectList();
};

window.switchProject = function(projectId) {
  closePanels();
  currentProjectId = projectId;
  document.getElementById('projectMenu').style.display = 'none';
  document.getElementById('backBar').style.display = '';
  document.getElementById('messagesBtn').disabled = false;
  document.getElementById('historyBtn').disabled = false;
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
  document.getElementById('backBar').style.display = 'none';
  document.getElementById('currentProjectName').textContent = "";
  document.getElementById('segmentList').innerHTML = '';
  document.getElementById('messagesBtn').disabled = true;
  document.getElementById('historyBtn').disabled = true;
  Object.values(statusLayers).forEach(layer => layer.clearLayers());
  loadProjectList();
};

window.toggleArchived = function() {
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

// ==== Segment Form: BUILT FROM GLOBAL CONFIG ====
window.map.on(L.Draw.Event.CREATED, async function (e) {
  const layer = e.layer;
  let geojson = layer.toGeoJSON();
  if (!geojson.properties) geojson.properties = {};

  drawnItems.addLayer(layer);

  await loadGlobalConfig();

  const uniqueId = `submitSegment_${Date.now()}_${Math.floor(Math.random()*10000)}`;
  let popupHtml = `<form id="segmentForm">`;
  for (const field of globalConfigFields) {
    if (!field.show) continue;
    const required = field.required ? "required" : "";
    popupHtml += `<div style="margin-bottom:6px">`;
    popupHtml += `<strong>${field.label}</strong><br/>`;
    if (field.type === "select") {
      popupHtml += `<select id="${field.key}Input" style="width:100%" ${required}>`;
      (field.options || []).forEach(opt => {
        popupHtml += `<option value="${opt}">${opt}</option>`;
      });
      popupHtml += `</select>`;
    } else if (field.type === "date") {
      popupHtml += `<input type="date" id="${field.key}Input" style="width:95%" ${required} />`;
    } else {
      popupHtml += `<input type="text" id="${field.key}Input" style="width:95%" ${required} />`;
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
        // Collect all field values
        const segData = { projectId: currentProjectId, archived: false, geojson: JSON.stringify(geojson), timestamp: firebase.firestore.FieldValue.serverTimestamp() };
        for (const field of globalConfigFields) {
          if (!field.show) continue;
          const val = document.getElementById(field.key+"Input").value;
          if (field.required && !val) return alert(`Field "${field.label}" is required.`);
          segData[field.key] = val;
        }
        try {
          const ref = await db.collection("segments").add(segData);
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
        let popupHtml = "";
        for (const field of globalConfigFields) {
          if (data[field.key] !== undefined && field.show)
            popupHtml += `<strong>${field.label}:</strong> ${data[field.key]}<br/>`;
        }
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

// ==== Segment List in Sidebar ====

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
  await loadGlobalConfig();

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
    for (const field of globalConfigFields) {
      if (!field.show) continue;
      if (field.key === "status") {
        html += `<div><strong>${field.label}:</strong>
          <select onchange="window.updateSegmentStatus('${doc.id}', this.value)">
            ${(field.options||[]).map(opt => `<option value="${opt}" ${data.status === opt ? "selected" : ""}>${opt}</option>`).join("")}
          </select></div>`;
      } else {
        html += `<div><strong>${field.label}:</strong> ${data[field.key] || ""}</div>`;
      }
    }
    html += `<button onclick="window.toggleSegmentArchive('${doc.id}', ${!data.archived})">
      ${data.archived ? 'Restore' : 'Archive'}
    </button></div>`;
  });
  segmentListDiv.innerHTML = html;
}

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

// Messenger UI
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

// History UI
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

// Messenger logic
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

// History logic
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

// ==== Initial Load ====
window.onload = async function() {
  await loadGlobalConfig();
  const urlParams = new URLSearchParams(window.location.search);
  const urlProjectId = urlParams.get("projectId");
  document.getElementById('messagesBtn').disabled = true;
  document.getElementById('historyBtn').disabled = true;
  if (urlProjectId)
