import axios from 'axios';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReCAPTCHA from "react-google-recaptcha";
import Cookies from "js-cookie";

axios.defaults.withCredentials = true;

export default function LogIn() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const data = {
      email: e.target.email.value,
      password: e.target.password.value,
    };

    if (!captchaToken) {
      setError("Please complete the CAPTCHA.");
      setLoading(false);
      return;
    }

    try {
      const res = await axios.post('http://localhost:5001/auth/login', {
        ...data,
        captcha_token: captchaToken,
      }, {
        withCredentials: true,
        headers: {
          "X-XSRF-TOKEN": Cookies.get("XSRF-TOKEN"),
        }
      });

      if (res.data.msg === "Login successful" || res.data.msg) {
        alert(res.data.msg);
        navigate('/dashboard'); // redirect if successful
      } else {
        setError("Login failed. Please try again.");
      }
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.msg || "Login error.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:5001/auth/login/google'; // Adjust if your backend URL is different
  };

  const handleCaptchaChange = (token) => {
    setCaptchaToken(token);
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center py-16 px-4">
      <div className="bg-gray-900 rounded-xl shadow-lg p-8 w-full max-w-md flex flex-col items-center">
        <h2 className="text-3xl font-bold text-blue-400 mb-6">Log In to SparkTower</h2>
        <button
          type="button"
          onClick={handleGoogleLogin}
          className="w-full flex items-center justify-center gap-2 py-3 mb-6 bg-white text-gray-900 font-semibold rounded hover:bg-gray-200 transition-colors"
        >
          <svg width="22" height="22" viewBox="0 0 48 48" className="inline-block"><g><path fill="#4285F4" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.3-5.7 7-11.3 7-6.6 0-12-5.4-12-12s5.4-12 12-12c2.7 0 5.2.9 7.2 2.4l6.1-6.1C34.3 5.5 29.4 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5c11 0 20.5-8.5 20.5-20.5 0-1.4-.1-2.7-.3-4z"/><path fill="#34A853" d="M6.3 14.1l6.6 4.8C14.5 16.1 18.9 13 24 13c2.7 0 5.2.9 7.2 2.4l6.1-6.1C34.3 5.5 29.4 3.5 24 3.5c-7.2 0-13.3 4.1-16.4 10.1z"/><path fill="#FBBC05" d="M24 44.5c5.4 0 10.3-1.8 14.1-4.9l-6.5-5.3c-2 1.4-4.5 2.2-7.6 2.2-5.6 0-10.3-3.7-12-8.7l-6.6 5.1C7.7 39.9 15.2 44.5 24 44.5z"/><path fill="#EA4335" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.1 3-3.6 5.2-6.8 6.1l6.5 5.3c-2.9 2-6.6 3.1-10.7 3.1-8.8 0-16.3-4.6-19.7-11.3l6.6-5.1c1.7 5 6.4 8.7 12 8.7 2.9 0 5.6-.8 7.6-2.2l6.5 5.3C34.3 42.7 29.4 44.5 24 44.5z"/></g></svg>
          Log in with Google
        </button>
        <form onSubmit={handleLogin} className="w-full flex flex-col gap-4">
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            autoComplete="email"
            className="px-4 py-3 rounded bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <input
            name="password"
            type="password"
            required
            placeholder="Password"
            autoComplete="current-password"
            className="px-4 py-3 rounded bg-gray-800 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <ReCAPTCHA
            sitekey="6LfvwJorAAAAAAynOmcghur_l24ZCJ05uDPOxneF"
            onChange={handleCaptchaChange}
            className="mx-auto"
          />
          <button type="submit" className="mt-2 py-3 bg-blue-600 hover:bg-blue-400 text-white font-semibold rounded transition-colors">Log In</button>
          {error && <p className="text-red-400 mt-2">{error}</p>}
        </form>
      </div>
    </div>
  );
}
