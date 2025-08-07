import { useState, useEffect } from "react";
import { useLocation, Routes, Route } from "react-router-dom";
import HeaderPublic from "./components/HeaderPublic";
import HeaderPrivate from "./components/HeaderPrivate";
import Landing from "./components/Landing";
import Footer from "./components/Footer";
import SignUp from "./components/SignUp";
import LogIn from "./components/LogIn";
import CreateProject from "./components/CreateProject";
import Dashboard from "./components/Dashboard";

function App() {
  const location = useLocation();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("access_token");
    setIsLoggedIn(!!token);
  }, [location]);

  return (
    <div className="bg-gray-950 text-white min-h-screen">
      {isLoggedIn ? <HeaderPrivate /> : <HeaderPublic />}
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/login" element={<LogIn />} />
        <Route path="/create-project" element={<CreateProject />} />
        <Route path="/dashboard" element={<Dashboard />} />
        {/* Add more routes as needed */}
      </Routes>
      <Footer />
    </div>
  );
}

export default App;
