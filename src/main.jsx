import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./meeting-action-extractor.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <GoogleOAuthProvider clientId="77065490099-3hv8t5n9nlddqs48hdphil370meectlb.apps.googleusercontent.com">
    <App />
  </GoogleOAuthProvider>
);