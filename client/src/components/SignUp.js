import Cookies from 'js-cookie';
import axios from 'axios';
import { useState, useEffect, useRef } from 'react';
import ReCAPTCHA from 'react-google-recaptcha';

export default function Signup() {
  const recaptchaRef = useRef();

useEffect(() => {
  axios.get('http://localhost:5001/', { withCredentials: true }).catch(err => {
    console.error("Initial CSRF token fetch failed:", err);
  });
}, []);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

const handleSignup = async (e) => {
  try {
    e.preventDefault();
    setLoading(true);
    setError("");

    let captchaToken = "";
    try {
      captchaToken = await recaptchaRef.current.executeAsync();
      recaptchaRef.current.reset();
    } catch (recaptchaErr) {
      console.error("reCAPTCHA failed:", recaptchaErr);
      setError("Failed to verify you’re a human. Please try again.");
      setLoading(false);
      return;
    }

    const data = {
      username: e.target.username.value,
      email: e.target.email.value,
      password: e.target.password.value,
      captcha_token: captchaToken,
    };

    const csrfToken = Cookies.get('XSRF-TOKEN');

    try {
      const res = await axios.post('http://localhost:5001/auth/signup', data, {
        withCredentials: true,
        timeout: 10000,
        headers: {
          "X-CSRFToken": csrfToken,
          "Content-Type": "application/json"
        }
      });

      if (res.data.msg) {
        alert(res.data.msg);
      } else {
        setError("Signup failed. Please try again.");
      }
    } catch (err) {
      console.error("Signup error caught:", err, err?.response);
      if (err?.response?.data?.msg) {
        setError(err.response.data.msg);
      } else if (typeof err === "string") {
        setError(err);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred.");
      }
    } finally {
      setLoading(false);
    }
  } catch (outerErr) {
    console.error("Unexpected signup error:", outerErr);
    setError("A critical error occurred. Please try again.");
  }
};

  const handleGoogleSignup = () => {
    window.location.href = 'http://localhost:5001/auth/login/google';
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center py-16 px-4">
      <div className="bg-gray-900 rounded-xl shadow-lg p-8 w-full max-w-md flex flex-col items-center">
        <h2 className="text-3xl font-bold text-blue-400 mb-6">Sign Up for SparkTower</h2>

        <button
          type="button"
          onClick={handleGoogleSignup}
          className="w-full flex items-center justify-center gap-2 py-3 mb-6 bg-white text-gray-900 font-semibold rounded hover:bg-gray-200 transition-colors"
        >
          {/* Google SVG */}
          Sign up with Google
        </button>

        <>
          <form onSubmit={handleSignup} className="w-full flex flex-col gap-4">
            <input name="username" required placeholder="Username" className="px-4 py-3 rounded bg-gray-800 text-white" />
            <input name="email" type="email" required placeholder="Email" className="px-4 py-3 rounded bg-gray-800 text-white" />
            <input name="password" type="password" required placeholder="Password" className="px-4 py-3 rounded bg-gray-800 text-white" />
            <button type="submit" disabled={loading} className="mt-2 py-3 bg-blue-600 hover:bg-blue-400 text-white font-semibold rounded transition-colors">
              {loading ? 'Signing up...' : 'Sign Up'}
            </button>
            {error && <p className="text-red-400 mt-2">{error}</p>}
          </form>
          <ReCAPTCHA
            ref={recaptchaRef}
            sitekey="6LfvwJorAAAAAAynOmcghur_l24ZCJ05uDPOxneF"
            size="invisible"
          />
        </>
      </div>
    </div>
  );
}