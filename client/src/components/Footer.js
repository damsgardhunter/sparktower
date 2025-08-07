import SparkTowerLogo from '../assets/SparkTower-transparent.png';

export default function Footer() {
  return (
    <footer className="bg-gray-950 text-gray-300 pt-12 pb-6 px-4 mt-16 relative">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start gap-8">
        {/* Logo bottom left */}
        <div className="flex flex-col items-start min-w-[120px]">
          <img src={SparkTowerLogo} alt="SparkTower logo" className="w-24 mb-4" />
          <span className="text-xs text-gray-500">ImagAInation LLC 2024</span>
        </div>
        {/* Center: SEO description */}
        <div className="flex-1 flex flex-col items-center text-center px-4">
          <p className="text-sm md:text-base font-medium mb-4 opacity-50 max-w-md">
            SparkTower by ImagAInation is the ultimate platform where developers, scientists, artists, and builders unite to create world-changing projects, compete in innovation contests, and collaborate openly—with built-in AI tools, project funding, and global recognition—all within a Kaggle-style UI with GitHub-like openness.
          </p>
        </div>
        {/* Menu */}
        <div className="flex flex-col gap-4 min-w-[180px]">
          <div className="mb-2">
            <span className="font-semibold text-white">Menu</span>
            <ul className="mt-2 space-y-2">
              <li><a href="#" className="hover:text-blue-400">Home</a></li>
              <li>
                <span className="font-semibold text-blue-300">Explore</span>
                <ul className="ml-4 mt-1 space-y-1">
                  {/* Categories placeholder */}
                  <li className="italic text-gray-500">(Categories coming soon)</li>
                </ul>
              </li>
              <li><a href="#" className="hover:text-blue-400">Contests</a></li>
              <li><a href="#" className="hover:text-blue-400">Leaderboard</a></li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}
