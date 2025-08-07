import React, { useState } from 'react';
import axios from 'axios';
import Cookies from 'js-cookie';
import HeaderPrivate from "./HeaderPrivate";
function NovaSidebar({ formData, aiRoles, useNova }) {
  const [novaQuery, setNovaQuery] = useState('');
  const [novaResponse, setNovaResponse] = useState('');

const handleAskNova = async () => {
    try {
      const csrfToken = Cookies.get('XSRF-TOKEN'); // Adjust name if different in backend
      const res = await axios.post(
        'http://localhost:5001/nova/ask',
        {
          title: formData.title,
          description: formData.description,
          category: formData.category,
          tags: formData.tags,
          timeline: formData.timeline,
          image: formData.image,
          question: novaQuery,
        },
        {
          withCredentials: true,
          headers: {
            'X-CSRF-TOKEN': csrfToken,
          },
        }
      );
      setNovaResponse(res.data.response || "Nova had no response.");
    } catch (err) {
      setNovaResponse("Nova encountered an error.");
      console.error("Nova error:", err);
    }
  };

  return (
    <aside className="w-1/4 bg-white p-4 border-r shadow-sm flex flex-col">
      <h2 className="text-xl font-semibold mb-4 text-black">🧠 Nova Assistant</h2>
      <div className="text-sm text-gray-800 mb-3">
        Nova can help estimate how long this project might take and suggest teammates along the way. Start by describing your idea and feel free to add roles later.
      </div>
      <div className="flex-1">
        <div className="text-sm text-gray-600 mb-2 overflow-y-auto max-h-96 min-h-[4rem] whitespace-pre-line border rounded p-2 bg-gray-50 scrollbar-thin scrollbar-thumb-gray-400 scrollbar-track-gray-100">
          {novaResponse || "Nova is ready to help you build your dream project."}
        </div>
        {useNova && aiRoles.length > 0 && (
          <div className="mb-2">
            <div className="font-semibold text-blue-600">Nova's Suggested Roles:</div>
            <ul className="list-disc list-inside text-sm">
              {aiRoles.map((role, idx) => <li key={idx}>{role}</li>)}
            </ul>
          </div>
        )}
        <ul className="text-sm list-disc list-inside space-y-1">
          <li>Get feedback on your title, description, or category.</li>
          <li>Ask Nova how to improve your project idea.</li>
          <li>Let Nova help you brainstorm roles and collaborators.</li>
        </ul>
        <div className="mt-6">
          <label htmlFor="novaQuery" className="text-sm font-medium text-gray-700">Ask Nova about your project</label>
          <textarea
            id="novaQuery"
            name="novaQuery"
            value={novaQuery}
            onChange={(e) => setNovaQuery(e.target.value)}
            rows={3}
            placeholder="What do you think of my idea so far?"
            className="w-full mt-1 p-2 border text-black rounded text-sm"
          />
          <button
            onClick={handleAskNova}
            className="mt-2 bg-indigo-600 text-white text-sm py-1 px-3 rounded hover:bg-indigo-700"
          >
            Ask Nova
          </button>
          <div className="text-xs text-gray-400 mt-2">
            Nova will respond with feedback, questions, or suggestions based on your current form progress.
          </div>
        </div>
      </div>
    </aside>
  );
}

export default function CreateProject() {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    category: '',
    tags: '',
    timeline: '',
    image: '',
    visibility: 'public',
    positions: '',
    status: 'Planning',
  });
  const [useNova, setUseNova] = useState(false);
  const [aiRoles, setAiRoles] = useState([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = async (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));

    // Trigger Nova suggestions when category changes and Nova is enabled
    if (name === 'category' && useNova) {
      try {
        const response = await axios.post('http://localhost:5000/nova/suggest-roles', {
          category: value,
          description: formData.description,
        }, { withCredentials: true });

        if (response.data && response.data.roles) {
          setAiRoles(response.data.roles);
        }
      } catch (err) {
        console.error("Error fetching Nova suggestions:", err);
      }
    }
  };

  const handleNovaToggle = () => {
    setUseNova(v => !v);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatusMessage("");
    setAiRoles([]);
    try {
      const payload = {
        ...formData,
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
        positions: formData.positions,
        use_nova: useNova,
        status: formData.status,
      };
      const res = await axios.post('http://localhost:5000/projects/create', payload, { withCredentials: true });
      if (res.data.ai_roles) {
        setAiRoles(res.data.ai_roles);
        setFormData(prev => ({ ...prev, tags: [...payload.tags, ...res.data.ai_roles].join(', ') }));
      }
      setStatusMessage(res.data.message || 'Project created successfully!');
    } catch (err) {
      setStatusMessage(err.response?.data?.error || 'Error creating project.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-50 min-h-25 pt-28">
      <HeaderPrivate />
      <div className="flex h-[calc(100vh-6rem)] mt-20">
        <NovaSidebar formData={formData} aiRoles={aiRoles} useNova={useNova} />
        <main className="flex-1 p-10 overflow-y-auto">
          <h1 className="text-3xl text-black font-bold mb-6">Create New Project</h1>
          <form className="space-y-6 max-w-3xl" onSubmit={handleSubmit}>
            <input
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="Project Title"
              className="w-full text-black p-3 border rounded"
              autoComplete="off"
              
            />
            <textarea
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Describe your project"
              rows={4}
              className="w-full text-black p-3 border rounded"
            />
            <select
              name="category"
              value={formData.category}
              onChange={handleChange}
              className="w-full text-black p-3 border rounded"
            >
              <option value="">Select a Category</option>

              <optgroup label="💻 Development">
                <option>Frontend Developer</option>
                <option>Backend Developer</option>
                <option>Full-Stack Developer</option>
                <option>Game Logic Programmer</option>
                <option>Gameplay Scripter (Lua, Blueprints)</option>
                <option>Network Engineer</option>
                <option>AI Developer (Pathfinding, Behavior Trees)</option>
                <option>Machine Learning Engineer</option>
                <option>Data Engineer</option>
                <option>Database Administrator (DBA)</option>
                <option>DevOps Engineer</option>
                <option>Embedded Systems Developer</option>
                <option>Mobile App Developer (iOS, Android)</option>
                <option>Web3 / Blockchain Developer</option>
                <option>AR/VR Developer</option>
                <option>Security Engineer (Penetration Tester, White Hat)</option>
                <option>API Integration Specialist</option>
                <option>Firmware Developer</option>
              </optgroup>

              <optgroup label="🎨 Design & Art">
                <option>UI/UX Designer</option>
                <option>Web Designer</option>
                <option>Interaction Designer</option>
                <option>2D Artist (Concept Art, Illustration)</option>
                <option>3D Artist (Modeling, Retopology)</option>
                <option>Character Designer</option>
                <option>Environment Designer</option>
                <option>Technical Artist</option>
                <option>VFX Artist (Particles, Shaders)</option>
                <option>Motion Designer</option>
                <option>Brand Designer / Logo Specialist</option>
                <option>Graphic Designer</option>
                <option>Industrial/Product Designer</option>
                <option>Texture Artist</option>
              </optgroup>

              <optgroup label="🧪 Science & Engineering">
                <option>Data Scientist</option>
                <option>Research Scientist (AI, ML, Physics, etc.)</option>
                <option>Physicist</option>
                <option>Mechanical Engineer</option>
                <option>Electrical Engineer</option>
                <option>Biotech Researcher</option>
                <option>Chemical Engineer</option>
                <option>Materials Scientist</option>
                <option>Aerospace Engineer</option>
                <option>Civil Engineer</option>
                <option>Structural Engineer</option>
                <option>Robotics Engineer</option>
                <option>Environmental Scientist</option>
                <option>Quantum Computing Researcher</option>
                <option>Computational Biologist</option>
                <option>Biomedical Engineer</option>
              </optgroup>

              <optgroup label="🔊 Audio & Media">
                <option>Sound Designer (SFX)</option>
                <option>Music Composer</option>
                <option>Audio Engineer (Mixing/Mastering)</option>
                <option>Voice Director</option>
                <option>Voice Actor</option>
                <option>Podcast Editor</option>
                <option>Foley Artist</option>
                <option>Audio Programmer (Wwise, FMOD)</option>
              </optgroup>

              <optgroup label="📊 Project & Operations">
                <option>Creative Director</option>
                <option>Project Manager</option>
                <option>Scrum Master</option>
                <option>Product Manager / Product Owner</option>
                <option>QA Tester</option>
                <option>QA Automation Engineer</option>
                <option>Technical Writer</option>
                <option>Community Manager</option>
                <option>Growth Hacker</option>
                <option>Marketing Strategist</option>
                <option>Content Manager</option>
                <option>Operations Manager</option>
              </optgroup>

              <optgroup label="📈 Business, Strategy & Legal">
                <option>Business Analyst</option>
                <option>Market Researcher</option>
                <option>Business Developer (BD)</option>
                <option>Legal Consultant (IP, Licensing)</option>
                <option>Financial Modeler</option>
                <option>Investor Relations Advisor</option>
                <option>Monetization Strategist</option>
              </optgroup>

              <optgroup label="🤖 AI & Automation">
                <option>Prompt Engineer</option>
                <option>LLM Fine-Tuner</option>
                <option>Data Labeling Specialist</option>
                <option>Autonomous Agent Designer</option>
                <option>AI Ethics Specialist</option>
                <option>Explainable AI (XAI) Analyst</option>
              </optgroup>

              <optgroup label="🌍 Open Roles / Miscellaneous">
                <option>Open Innovation Contributor</option>
                <option>Hackathon Collaborator</option>
                <option>Volunteer Developer</option>
                <option>Crowdsourced Designer</option>
                <option>Cross-discipline Advisor</option>
              </optgroup>
            </select>
            <textarea
              name="positions"
              value={formData.positions}
              onChange={handleChange}
              placeholder="Needed Positions (comma-separated or leave blank to accept Nova's suggestions)"
              rows={2}
              className="w-full text-black p-3 border rounded"
            />
            {useNova && aiRoles.length > 0 && (
              <div className="text-sm text-gray-700">
                <p className="mb-1">Nova Suggestions:</p>
                <ul className="list-disc list-inside">
                  {aiRoles.map((role, idx) => <li key={idx}>{role}</li>)}
                </ul>
              </div>
            )}
            <input
              name="tags"
              value={formData.tags}
              onChange={handleChange}
              placeholder="Comma-separated Tags"
              className="w-full text-black p-3 border rounded"
            />
            <input
              name="timeline"
              value={formData.timeline}
              onChange={handleChange}
              placeholder="Timeline (e.g., 2 months)"
              className="w-full text-black p-3 border rounded"
            />
            <input
              name="status"
              value={formData.status}
              onChange={handleChange}
              placeholder="Project Status (e.g., Planning, In Progress)"
              className="w-full text-black p-3 border rounded"
            />
            <input
              name="image"
              value={formData.image}
              onChange={handleChange}
              placeholder="Image URL (optional)"
              className="w-full text-black p-3 border rounded"
            />
            <select
              name="visibility"
              value={formData.visibility}
              onChange={handleChange}
              className="w-full text-black p-3 border rounded"
            >
              <option value="public"  className="text-black">Public</option>
              <option value="private" className="text-black">Private</option>
              <option value="unlisted" className="text-black">Unlisted</option>
            </select>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="useNova" checked={useNova} onChange={handleNovaToggle} />
              <label htmlFor="useNova" className="text-sm">Let Nova suggest roles for this project</label>
            </div>
            <button type="submit" className="bg-blue-600 text-white py-2 px-6 rounded hover:bg-blue-700" disabled={loading}>
              {loading ? 'Creating...' : 'Create Project'}
            </button>
            {statusMessage && <div className="mt-2 text-sm text-blue-700">{statusMessage}</div>}
          </form>
        </main>
      </div>
    </div>
  );
}