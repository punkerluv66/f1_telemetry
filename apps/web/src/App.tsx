import { BrowserRouter, Route, Routes } from "react-router-dom";
import { SessionSelect } from "./pages/SessionSelect";
import { DriverSelect } from "./pages/DriverSelect";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SessionSelect />} />
        <Route path="/session/:id" element={<DriverSelect />} />
      </Routes>
    </BrowserRouter>
  );
}
