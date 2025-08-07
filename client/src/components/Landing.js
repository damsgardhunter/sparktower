import React, { useEffect, useRef, useState } from "react";

export default function Landing() {
  // Animation state for featured projects
  const [showFeatured, setShowFeatured] = useState(false);
  const featuredRef = useRef(null);

  useEffect(() => {
    const observer = new window.IntersectionObserver(
      ([entry]) => {
        setShowFeatured(entry.isIntersecting);
      },
      { threshold: 0.3 }
    );
    if (featuredRef.current) {
      observer.observe(featuredRef.current);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Hero Section */}
      <section className="bg-gray-950 text-white min-h-screen flex items-center justify-center pt-32">
        <div className="text-center px-6">
          <h1 className="text-5xl font-extrabold mb-6 text-grey-400">
            Build Tomorrow. <span className="text-blue-400">Together.</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto text-gray-300">
            Join a global platform built for{" "}
            <span className="text-aqua-400"> Innovation. </span>
          </p>
          <div className="mt-10">
            <button className="px-6 py-3 text-lg bg-blue-600 hover:bg-blue-400 rounded mr-4">
              Get Started
            </button>
            <button className="px-6 py-3 text-lg bg-gray-700 hover:bg-gray-600 rounded">
              Browse Projects
            </button>
          </div>
        </div>
      </section>
      {/* How it works section */}
      <section className="bg-gray-900 text-white py-20 flex flex-col items-center">
        <h2 className="text-3xl font-bold mb-12 text-center text-green-300">
          HOW IT WORKS
        </h2>
        <div className="flex flex-col md:flex-row justify-center items-center gap-12 w-full max-w-4xl">
          {/* Step 1 */}
          <div className="flex items-center w-full md:w-1/3 justify-start md:justify-center">
            <div className="flex items-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full border-2 border-aqua-400 text-2xl font-bold mr-4 transition-colors duration-200 bg-gray-800 hover:bg-teal-400 hover:text-gray-900 cursor-pointer select-none">
                1
              </span>
              <span className="text-lg text-gray-200">
                Create or Join Projects
              </span>
            </div>
          </div>
          {/* Step 2 */}
          <div className="flex items-center w-full md:w-1/3 justify-center">
            <div className="flex items-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full border-2 border-aqua-400 text-2xl font-bold mr-4 transition-colors duration-200 bg-gray-800 hover:bg-teal-400 hover:text-gray-900 cursor-pointer select-none">
                2
              </span>
              <span className="text-lg text-gray-200">Compete in Contests</span>
            </div>
          </div>
          {/* Step 3 */}
          <div className="flex items-center w-full md:w-1/3 justify-end md:justify-center">
            <div className="flex items-center">
              <span className="flex items-center justify-center w-14 h-14 rounded-full border-2 border-aqua-400 text-2xl font-bold mr-4 transition-colors duration-200 bg-gray-800 hover:bg-teal-400 hover:text-gray-900 cursor-pointer select-none">
                3
              </span>
              <span className="text-lg text-gray-200">
                Earn Support & Funding
              </span>
            </div>
          </div>
        </div>
      </section>
      {/* Featured Projects section */}
      <section
        ref={featuredRef}
        className="bg-gray-900 text-white py-20 flex flex-col items-center"
      >
        <h2 className="text-3xl font-bold mb-12 text-center text-yellow-300">
          FEATURED PROJECTS
        </h2>
        <div className="flex justify-center items-end gap-8 w-full max-w-5xl">
          {/* 3rd Place */}
          <div className="flex flex-col items-center w-1/3">
            <div
              className={`bg-gray-800 rounded-lg shadow-lg w-full h-40 flex items-center justify-center mb-2 relative z-10 transition-transform duration-700 ${
                showFeatured ? "translate-y-0 opacity-100" : "translate-y-24 opacity-0"
              }`}
              style={{ transitionDelay: showFeatured ? "200ms" : "0ms" }}
            >
              <span className="absolute top-2 left-2 text-2xl font-bold text-gray-400">
                3
              </span>
              {/* Project info goes here */}
            </div>
            <div
              className="bg-yellow-700 w-20 h-10 rounded-t-md"
              style={{ height: "40px" }}
            ></div>
          </div>
          {/* 1st Place */}
          <div className="flex flex-col items-center w-1/3">
            <div
              className={`bg-gray-800 rounded-lg shadow-2xl w-full h-48 flex items-center justify-center mb-2 relative z-10 border-4 border-yellow-400 transition-transform duration-700 ${
                showFeatured ? "translate-y-0 opacity-100" : "translate-y-32 opacity-0"
              }`}
              style={{ transitionDelay: showFeatured ? "400ms" : "0ms" }}
            >
              <span className="absolute top-2 left-2 text-2xl font-bold text-yellow-400">
                1
              </span>
              {/* Project info goes here */}
            </div>
            <div
              className="bg-yellow-400 w-20 h-20 rounded-t-md"
              style={{ height: "80px" }}
            ></div>
          </div>
          {/* 2nd Place */}
          <div className="flex flex-col items-center w-1/3">
            <div
              className={`bg-gray-800 rounded-lg shadow-lg w-full h-44 flex items-center justify-center mb-2 relative z-10 transition-transform duration-700 ${
                showFeatured ? "translate-y-0 opacity-100" : "translate-y-28 opacity-0"
              }`}
              style={{ transitionDelay: showFeatured ? "600ms" : "0ms" }}
            >
              <span className="absolute top-2 left-2 text-2xl font-bold text-gray-300">
                2
              </span>
              {/* Project info goes here */}
            </div>
            <div
              className="bg-gray-300 w-20 h-16 rounded-t-md"
              style={{ height: "64px" }}
            ></div>
          </div>
        </div>
      </section>
      {/* Join the Community section */}
      <section className="bg-gray-950 text-white py-20">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">Join the Community</h2>
          <p className="text-lg text-gray-300 mb-8">
            Connect with innovators, developers, and creators from around the
            world. Share ideas, collaborate on projects, and build the future
            together.
          </p>
          <button className="px-6 py-3 bg-blue-600 hover:bg-blue-400 text-white text-lg rounded">
            Sign Up Now
          </button>
        </div>
      </section>
    </>
  );
}