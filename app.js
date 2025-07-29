// Firebase Initialization
if (typeof firebase === "undefined") {
  document.body.innerHTML = '<h2 style="color:red">❌ Firebase SDK not loaded in app.js. Check map.html script order.</h2>';
  throw new Error("Firebase SDK not loaded");
}
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

const urlParams = new URLSearchParams(window.location.search);
const projectId = urlParams.get("projectId");

if (!projectId) {
  alert("No project selected");
  window.location.href = "dashboard.html";
}

// Initialize Map
const map = L.map("map").setView([41.865, -103.667], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png").addTo(map);
const drawnItems = new L.FeatureGroup().addTo(map);

// Layer control
const statusLayers = {
  "Not Located": new L.FeatureGroup().addTo(map),
  "In Progress": new L.FeatureGroup().addTo(map),
  "Located": new L.FeatureGroup().addTo(map),
};
L.control.layers(null, statusLayers).addTo(map);

// Draw controls
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

// Draw event handler
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

// Load existing segments
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

// 🔧 TEMP: Bypass login
loadSegments();
