import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SparkTowerLogo from '../assets/SparkTower-transparent.png';



export default function Header() {
  const [viewBoxWidth, setViewBoxWidth] = useState(window.innerWidth);
  const headerRef = useRef(null);
  const streamRef = useRef(null);
  const homeRef = useRef(null);
  const exploreRef = useRef(null);
  const contestRef = useRef(null);
  const leaderboardRef = useRef(null);

  const updateStreamPath = () => {
    const bolt = boltRef.current;
    const login = loginRef.current;
    const stream = streamRef.current;
    const header = headerRef.current;

    if (!bolt || !login || !stream || !header) {
      console.warn('Missing element:', {
        boltExists: !!bolt,
        loginExists: !!login,
        streamExists: !!stream,
        headerExists: !!header,
      });
      return;
    }

    stream.setAttribute('d', '');
    stream.style.display = 'none';

    requestAnimationFrame(() => {
      stream.getBoundingClientRect(); // force reflow
      if (bolt && login && stream && header) {
        const boltRect = bolt.getBoundingClientRect();
        const loginRect = login.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();

        const boltX = boltRect.left - headerRect.left + boltRect.width / 2;
        const boltY = boltRect.top - headerRect.top + boltRect.height / 2;
        const loginX = loginRect.left - headerRect.left + loginRect.width / 2;
        const loginY = loginRect.top - headerRect.top + loginRect.height / 2;

        const homeRect = homeRef.current?.getBoundingClientRect();
        const homeX = homeRect.left;
        const exploreRect = exploreRef.current?.getBoundingClientRect();
        const exploreX = exploreRect.left;
        const contestRect = contestRef.current?.getBoundingClientRect();
        const contestX = contestRect.left;
        const leaderboardRect = leaderboardRef.current?.getBoundingClientRect();
        const leaderboardLeft = leaderboardRect.left;
        const leaderboardRight = leaderboardRect.right;      
        
        const firstStopX = homeX - boltX;
        

        console.log('bolt:', { x: boltX, y: boltY }, 'login:', { x: loginX, y: loginY });

        const distanceX = loginX - boltX;
        const distanceY = loginY - boltY;

        let curveOffset;
        const height = window.innerHeight;

        if (height < 500) {
            curveOffset = 44;
        } else if (height < 800) {
            curveOffset = 46;
        } else {
            curveOffset = 50;
        }

        
        if (isFinite(boltX) && isFinite(boltY) && isFinite(loginX) && isFinite(loginY)) {
          // Sharp zig-zag path using H and V commands
          const path = `M${boltX},${boltY - 12}
                        H${homeX - 15} V${boltY + curveOffset}
                        H${exploreX - 10} V${boltY - 12}
                        H${contestX - 10} V${boltY + curveOffset}
                        H${leaderboardLeft - 10} V${boltY - 12}
                        H${leaderboardRight + 10} V${boltY - 20 + curveOffset}
                        H${loginX - 90} V${loginY}`;
          console.log('Setting stream path:', path);
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

  useEffect(() => {
    const updateWidth = () => {
      const rect = headerRef.current?.getBoundingClientRect();
      setViewBoxWidth(rect ? rect.width : window.innerWidth);
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    let isRunning = true;

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

    const animateOnce = async () => {
      for (let j = 0; j < steps.length; j++) {
        if (!isRunning) return;
        await new Promise((res) => setTimeout(res, 240));
        const el = document.getElementById(steps[j].id);
        if (el) el.setAttribute('stop-color', steps[j].color);
      }

      const stream = streamRef.current;
      if (stream) {
        stream.style.animation = 'none';
        stream.style.opacity = 0;

        void stream.offsetWidth; // force reflow

        await new Promise(res => requestAnimationFrame(res));
        updateStreamPath(); // ensure path is fresh after paint

        stream.style.opacity = 1;
        stream.style.animation = 'streamWeave 2s ease-in-out forwards';
      }

      // Animate the signup-charge button (charge bar effect) only after path ends at login position
      const finalPath = streamRef.current?.getAttribute('d');
      if (finalPath && loginRef.current && headerRef.current) {
        const loginRect = loginRef.current.getBoundingClientRect();
        const headerRect = headerRef.current.getBoundingClientRect();
        const loginX = (loginRect.left - headerRect.left + loginRect.width / 2).toFixed(1);
        const loginY = (loginRect.top - headerRect.top + loginRect.height / 2).toFixed(1);
        const expectedEnd = `H${loginX} V${loginY}`;
        if (finalPath.trim().endsWith(expectedEnd)) {
          const signupButton = document.querySelector('.signup-charge');
          if (signupButton) {
            signupButton.classList.add('charged');
          }
        }
      }

      // Increase the duration the data stream stays on screen
      await new Promise((res) => setTimeout(res, 8870));
      if (!isRunning) return;

      steps.forEach((step) => {
        const el = document.getElementById(step.id);
        if (el) el.setAttribute('stop-color', 'white');
      });

      if (stream) {
        stream.style.opacity = 0;
        stream.style.animation = 'none';
      }
    };

    const startLoop = async () => {
      // Wait for refs to be available
      while (!boltRef.current || !loginRef.current) {
        await new Promise(res => requestAnimationFrame(res));
      }
      while (isRunning) {
        updateStreamPath();
        await animateOnce();
        await new Promise((res) => setTimeout(res, 0));
      }
    };

    startLoop();

    return () => {
      isRunning = false;
    };
  }, []);

  const boltRef = useRef(null);
  const loginRef = useRef(null);

  useEffect(() => {
    const bolt = boltRef.current;
    const login = loginRef.current;
    const stream = streamRef.current;
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
    stream.style.display = 'none';

    const delayAndUpdate = () => {
      setTimeout(() => {
        requestAnimationFrame(() => {
          updateStreamPath();
        });
      }, 0);
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
    <header ref={headerRef} className="fixed top-0 left-0 w-full bg-gray-900 text-white shadow-md z-50">
      <svg viewBox={`0 0 ${viewBoxWidth} 100`} preserveAspectRatio="xMinYMin meet" className="absolute top-[5px] left-[0px] w-full h-auto pointer-events-none z-40">
        <defs>
          <linearGradient id="trailGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#00F0AA" stopOpacity="1" />
            <stop offset="100%" stopColor="#00F0AA" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          id="data-stream"
          ref={streamRef}
          d=""
          stroke="url(#trailGradient)"
          strokeWidth="2"
          fill="none"
          style={{ opacity: 0, display: 'none' }}
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
          <a href="#" ref={homeRef} className="hover:text-purple-300">Home</a>
          <a href="#" ref={exploreRef} className="hover:text-purple-300">Explore</a>
          <a href="#"  ref={contestRef} className="hover:text-purple-300">Contests</a>
          <a href="#"  ref={leaderboardRef} className="hover:text-purple-300">Leaderboard</a>
        </nav>
        <div className="space-x-4">
          <Link to="/signup">
            <button className="px-6 py-3 text-md bg-gray-800 hover:bg-gray-700 text-white rounded signup-charge"><span>Sign Up</span></button>
          </Link>
          <Link to="/login">
            <button ref={loginRef} className="px-6 py-3 text-md bg-blue-600 hover:bg-blue-700 text-white rounded">Log In</button>
          </Link>
        </div>
      </div>
    </header>
  )}
