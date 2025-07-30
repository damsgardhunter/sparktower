export default function Landing() {
  return (
    <section className="bg-gray-950 text-white min-h-screen flex items-center justify-center pt-32">
      <div className="text-center px-6">
        <h1 className="text-5xl font-extrabold mb-6 text-blue-400">
          Build Tomorrow. <span className="text-blue-600">Together.</span>
        </h1>
        <p className="text-lg max-w-xl mx-auto text-gray-300">
          Welcome to <span className="text-blue-600"> SparkTower </span>
        </p>
        <div className="mt-10">
          <button className="px-6 py-3 text-lg bg-blue-600 hover:bg-blue-700 rounded mr-4">Get Started</button>
          <button className="px-6 py-3 text-lg bg-gray-700 hover:bg-gray-600 rounded">Learn More</button>
        </div>
      </div>
    </section>
  );
}