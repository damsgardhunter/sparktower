import { useEffect, useRef, useState } from 'react';
import SparkTowerLogo from '../assets/SparkTower-transparent.png';



export default function Header() {
  const [viewBoxWidth, setViewBoxWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setViewBoxWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const steps = [
      { id: 'stop0', color: '#002C5F' },
      { id: 'stop5', color: '#002C5F' },
      { id: 'stop10', color: '#002C5F' },
      { id: 'stop15', color: '#00D8D8' },
      { id: 'stop20', color: '#00D8D8' },
      { id: 'stop25', color: '#00D8D8' },
      { id: 'stop30', color: '#00D8D8' },
      { id: 'stop35', color: '#00D8D8' },
      { id: 'stop40', color: '#00F0FF' },
      { id: 'stop45', color: '#00F0FF' },
      { id: 'stop50', color: '#00F0FF' },
      { id: 'stop55', color: '#00F0FF' },
      { id: 'stop60', color: '#00F0FF' },
      { id: 'stop65', color: '#00F0FF' },
      { id: 'stop70', color: '#00F0AA' },
      { id: 'stop75', color: '#00F0AA' },
      { id: 'stop80', color: '#00F0AA' },
      { id: 'stop85', color: '#00F0AA' },
      { id: 'stop90', color: '#00F0AA' },
      { id: 'stop95', color: '#00F0AA' },
      { id: 'stop100', color: '#00F0AA' },
    ];

    const loop = async () => {
      while (true) {
        for (let j = 0; j < steps.length; j++) {
          await new Promise((res) => setTimeout(res, 250));
          document.getElementById(steps[j].id).setAttribute('stop-color', steps[j].color);
        }
        // Animate data stream right after fill is complete
        const stream = document.getElementById('data-stream');
        if (stream) {
          stream.style.opacity = 1;
          stream.style.animation = 'streamWeave 2s ease-in-out forwards';
        }
        await new Promise((res) => setTimeout(res, 10000)); // wait for viewer interaction time

        await new Promise((res) => setTimeout(res, 1000));
        // Reset bolt and stream
        steps.forEach((step) => {
          document.getElementById(step.id).setAttribute('stop-color', 'white');
        });
        if (stream) {
          stream.style.opacity = 0;
          stream.style.animation = 'none';
        }
      }
    };

    loop();
  }, []);

  const boltRef = useRef(null);
  const loginRef = useRef(null);

  useEffect(() => {
    const bolt = boltRef.current;
    const login = loginRef.current;
    const stream = document.getElementById('data-stream');
    console.log('Running path update useEffect');

    if (!bolt || !login || !stream) {
      console.warn('Missing element:', {
        boltExists: !!bolt,
        loginExists: !!login,
        streamExists: !!stream,
      });
      return;
    }

    stream.setAttribute('d', '');
    stream.removeAttribute('d');
    stream.style.display = 'none';

    const updateStreamPath = () => {
      console.log('bolt rect:', bolt.getBoundingClientRect(), 'login rect:', login.getBoundingClientRect());
      requestAnimationFrame(() => {
        stream.getBoundingClientRect(); // force reflow
        if (bolt && login && stream) {
          const boltRect = bolt.getBoundingClientRect();
          const loginRect = login.getBoundingClientRect();

          const boltX = boltRect.left + boltRect.width / 2 - window.scrollX;
          const boltY = boltRect.top + boltRect.height / 2 + window.scrollY;
          const loginX = loginRect.left + loginRect.width / 2 - window.scrollX;
          const loginY = loginRect.top + loginRect.height / 2 + window.scrollY;

          console.log('bolt:', { x: boltX, y: boltY }, 'login:', { x: loginX, y: loginY });

          const midX1 = boltX + (loginX - boltX) * 0.25;
          const midX2 = boltX + (loginX - boltX) * 0.5;
          const midX3 = boltX + (loginX - boltX) * 0.75;

          if (isFinite(boltX) && isFinite(boltY) && isFinite(loginX) && isFinite(loginY)) {
            const path = `M${boltX},${boltY} 
                          H${midX1} V${boltY + 40} 
                          H${midX2} V${boltY} 
                          H${midX3} V${boltY + 40} 
                          H${loginX} V${loginY}`;
            console.log('Setting stream path:', path);
            stream.style.display = 'none';
            stream.setAttribute('d', path);
            stream.style.display = 'inline';
          } else {
            console.warn('Invalid path points:', { boltX, boltY, loginX, loginY });
            stream.setAttribute('d', '');
            stream.style.display = 'none';
          }
        }
      });
    };

    const delayAndUpdate = () => {
      requestAnimationFrame(() => {
        updateStreamPath();
      });
    };

    if (document.readyState === 'complete') {
      delayAndUpdate();
    } else {
      window.addEventListener('load', delayAndUpdate);
    }

    window.addEventListener('resize', updateStreamPath);
    return () => {
      window.removeEventListener('resize', updateStreamPath);
      window.removeEventListener('load', delayAndUpdate);
    };
  }, []);

  return (
    <header className="fixed top-0 left-0 w-full bg-gray-900 text-white shadow-md z-50">
      <svg viewBox={`0 0 ${viewBoxWidth} 100`} preserveAspectRatio="xMinYMin meet" className="absolute top-[5px] left-[0px] w-full h-auto translate-x-[1%] pointer-events-none z-40">
        <defs>
          <linearGradient id="trailGradient" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#00F0AA" stopOpacity="1" />
            <stop offset="100%" stopColor="#00F0AA" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          id="data-stream"
          d=""
          stroke="url(#trailGradient)"
          strokeWidth="2"
          fill="none"
          style={{ opacity: 0 }}
        />
      </svg>
      <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-2">
          <div className="relative w-24 h-28">
            <img src={SparkTowerLogo} alt="SparkTower logo" className="w-full h-full" />
            <div ref={boltRef} className="absolute top-[11.5%] left-[55%] w-5 h-4 transform -translate-x-[56%]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 64 64"
                className="w-full h-full"
                >
                <defs>
                  <linearGradient id="boltGradient" x1="0%" y1="100%" x2="0%" y2="0%">
                    <stop id="stop0" offset="0%" stopColor="white" />
                    <stop id="stop5" offset="5%" stopColor="white" />
                    <stop id="stop10" offset="10%" stopColor="white" />
                    <stop id="stop15" offset="15%" stopColor="white" />
                    <stop id="stop20" offset="20%" stopColor="white" />
                    <stop id="stop25" offset="25%" stopColor="white" />
                    <stop id="stop30" offset="30%" stopColor="white" />
                    <stop id="stop35" offset="35%" stopColor="white" />
                    <stop id="stop40" offset="40%" stopColor="white" />
                    <stop id="stop45" offset="45%" stopColor="white" />
                    <stop id="stop50" offset="50%" stopColor="white" />
                    <stop id="stop55" offset="55%" stopColor="white" />
                    <stop id="stop60" offset="60%" stopColor="white" />
                    <stop id="stop65" offset="65%" stopColor="white" />
                    <stop id="stop70" offset="70%" stopColor="white" />
                    <stop id="stop75" offset="75%" stopColor="white" />
                    <stop id="stop80" offset="80%" stopColor="white" />
                    <stop id="stop85" offset="85%" stopColor="white" />
                    <stop id="stop90" offset="90%" stopColor="white" />
                    <stop id="stop95" offset="95%" stopColor="white" />
                    <stop id="stop100" offset="100%" stopColor="white" />
                  </linearGradient>
                </defs>

                <path
                    d="M23.5 0L0 35.8h15.9L11 64 41 28.6H25.6L31.6 0H23.5z"
                    fill="url(#boltGradient)"
                />
              </svg>
              
            </div>
          </div>
        </div>
        <nav className="space-x-6 hidden md:flex">
          <a href="#" className="hover:text-purple-300">Home</a>
          <a href="#" className="hover:text-purple-300">Explore</a>
          <a href="#" className="hover:text-purple-300">Contests</a>
          <a href="#" className="hover:text-purple-300">Leaderboard</a>
        </nav>
        <div className="space-x-4">
          <button className="px-6 py-3 text-md bg-gray-800 hover:bg-gray-700 text-white rounded">Sign Up</button>
          <button ref={loginRef} className="px-6 py-3 text-md bg-blue-600 hover:bg-blue-700 text-white rounded">Log In</button>
        </div>
      </div>
    </header>
  );
}