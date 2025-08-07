import HeaderPrivate from "./HeaderPrivate";

export default function Dashboard() {
  return (
    <div className="bg-gray-950 text-white min-h-screen">
      <HeaderPrivate />
      <main className="max-w-6xl mx-auto p-6 space-y-12">

        {/* My Projects Section */}
        <section>
          <h2 className="text-2xl top-5 font-bold mb-4">My Projects</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Project cards will be dynamically generated */}
            <div className="bg-gray-800 p-4 rounded shadow">Project 1</div>
            <div className="bg-gray-800 p-4 rounded shadow">Project 2</div>
            <div className="bg-gray-800 p-4 rounded shadow">Project 3</div>
          </div>
        </section>

        {/* Leaderboard Preview */}
        <section>
          <h2 className="text-2xl font-bold mb-4">Top Innovators</h2>
          <div className="bg-gray-900 p-4 rounded shadow">
            {/* Replace this with leaderboard component later */}
            <ul className="space-y-2">
              <li>#1 - NovaBuildz (450 pts)</li>
              <li>#2 - SkyHackers (430 pts)</li>
              <li>#3 - TechSavants (410 pts)</li>
            </ul>
          </div>
        </section>

        {/* Recommended Projects (Nova AI will assist) */}
        <section>
          <h2 className="text-2xl font-bold mb-4">Recommended Projects</h2>
          <p className="text-sm text-gray-400 mb-2">
            These are based on your uploaded resume and project interests.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-800 p-4 rounded">AI Game Co-op</div>
            <div className="bg-gray-800 p-4 rounded">Autonomous Drone AI</div>
          </div>
        </section>

        {/* Explore Contests */}
        <section>
          <h2 className="text-2xl font-bold mb-4">Available Contests</h2>
          <div className="space-y-4">
            <div className="bg-gray-900 p-4 rounded">
              <h3 className="text-lg font-semibold">AI for Climate Hackathon</h3>
              <p className="text-sm text-gray-300">Win up to $10,000 by building an AI tool for sustainability.</p>
            </div>
            <div className="bg-gray-900 p-4 rounded">
              <h3 className="text-lg font-semibold">Space Robotics Showdown</h3>
              <p className="text-sm text-gray-300">Compete to design a Mars rover simulation controller.</p>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
