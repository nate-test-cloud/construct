import React from "react";
import ReactDOM from "react-dom/client";
import { GoogleOAuthProvider } from "@react-oauth/google";
import App from "./meeting-action-extractor.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <GoogleOAuthProvider clientId="">
    <App />
  </GoogleOAuthProvider>
);
