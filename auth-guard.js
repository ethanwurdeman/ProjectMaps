// auth-guard.js
document.addEventListener("DOMContentLoaded", () => {
  const waitForFirebase = () => {
    if (typeof firebase === "undefined" || !firebase.auth) {
      setTimeout(waitForFirebase, 100);
      return;
    }

    if (firebase.apps.length === 0) {
      firebase.initializeApp({
        apiKey: "AIzaSyBizMeB33zvk5Qr9JcE2AJNmx2sr8PnEyk",
        authDomain: "projectmap-35a69.firebaseapp.com",
        projectId: "projectmap-35a69",
        storageBucket: "projectmap-35a69.appspot.com",
        messagingSenderId: "676439686152",
        appId: "1:676439686152:web:0fdc2d8aab41aec67fa5bd"
      });
    }

    const auth = firebase.auth();
    const userStatus = document.getElementById("userStatus");

    auth.onAuthStateChanged(user => {
      if (!user) {
        window.location.href = "login.html";
      } else {
        if (userStatus) {
          userStatus.innerHTML = `
            Logged in as <strong
