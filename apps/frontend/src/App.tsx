import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import InboxPage from "./pages/InboxPage";
import UploadPage from "./pages/UploadPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/upload" element={<UploadPage />} />

        <Route path="/inbox" element={<InboxPage />} />

        <Route path="*" element={<Navigate to="/upload" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
