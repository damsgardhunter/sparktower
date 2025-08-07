from dotenv import load_dotenv
import os
from openai import OpenAI
from flask import request, jsonify, Blueprint
from flask_jwt_extended import jwt_required, get_jwt_identity
import json
from db import get_connection 
from extensions import csrf

load_dotenv()
test_openai_bp = Blueprint('test_openai_bp', __name__)
openai.api_key = os.getenv("OPENAI_API_KEY")

@test_openai_bp.route('/test-openai', methods=['GET'])
def test_openai():
    client = os.getenv("OPENAI_API_KEY")

    try:
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[{"role": "user", "content": "Say hello from Nova"}],
            max_tokens=10
        )
        return jsonify({'success': True, 'response': response.choices[0].message.content}), 200

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@test_openai_bp.route('/projects/create', methods=['POST'])
@jwt_required()
def create_project():
    data = request.get_json()
    current_user = get_jwt_identity()

    title = data.get('title')
    description = data.get('description')
    category = data.get('category')
    tags = data.get('tags', [])
    visibility = data.get('visibility', 'public')
    timeline = data.get('timeline')
    status = data.get('status', 'Planning')
    image_url = data.get('project_image_url')
    ai_generated_roles = data.get('ai_generated_roles', False)

    if data.get('use_nova'):
        prompt = f"""You are Nova, an intelligent AI project assistant. 
        You are to remember as an Assitant that you are here to help the user and be supportive of their ideas. 
        The user is trying to create a new project and has provided the following details:

Project Title: '{title}'
Description: '{description}'
Category: '{category}'

Your task:
1. Ask clarifying or exploratory questions to better understand the user's idea (keep it short and curious).
2. Provide suggestions to improve the title or description if needed.
3. Suggest a category if none is given or recommend alternatives if the current category may be unclear.
4. Recommend 3–7 specific team roles relevant to the project scope.
Format your response as:
---
Questions:
- Question 1
- Question 2

Suggestions:
- Suggestion 1
- Suggestion 2

Recommended Roles:
- Role 1
- Role 2
- ...

This is a collaborative process, so be friendly and helpful.
Here is further context:
1. Keep responses consise and under 120 words.
2. Use bullet points and emojis for clarity.
3. Avoid jargon or overly technical language.
4. Focus on the user's needs and how you can assist them.
5. Always end with a positive note, encouraging the user to share more details or ask questions.
---
"""
        openai.api_key = os.getenv("OPENAI_API_KEY")
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are Nova, an AI project assistant helping users structure innovative projects."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=250
        )
        ai_response = response['choices'][0]['message']['content']
        role_section = ai_response.split("Recommended Roles:")[-1]
        ai_roles = [r.lstrip('- ').strip() for r in role_section.strip().split('\n') if r.strip()]
        data['tags'].extend(ai_roles)
        ai_generated_roles = True

    if not title or not category:
        return jsonify({'error': 'Title and category are required'}), 400

    if len(title) > 100:
        return jsonify({'error': 'Title is too long'}), 400
    if len(description) > 5000:
        return jsonify({'error': 'Description is too long'}), 400
    if len(category) > 100:
        return jsonify({'error': 'Category is too long'}), 400

    cursor = connection.cursor()
    cursor.execute("""
        INSERT INTO projects (title, description, category, tags, created_by, visibility, timeline, status, project_image_url, ai_generated_roles)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        title, description, category, json.dumps(tags), current_user, visibility, timeline, status, image_url, ai_generated_roles
    ))
    connection.commit()

    project_id = cursor.lastrowid
    return jsonify({'message': 'Project created successfully', 'project_id': project_id}), 201

@csrf.exempt
@test_openai_bp.route('/nova/ask', methods=['POST'])
# @jwt_required()
def nova_ask():
    data = request.get_json()
    title = data.get('title')
    description = data.get('description')
    category = data.get('category')
    tags = data.get('tags', [])
    timeline = data.get('timeline')
    image = data.get('image')
    question = data.get('question')

    prompt = f"""You are Nova, an intelligent AI project assistant. A user is asking for guidance on their project.

Project Title: '{title}'
Description: '{description}'
Category: '{category}'
Tags: {tags}
Timeline: {timeline}
Image: {image}

User Question: {question}

Respond with helpful suggestions, questions, or feedback based on their input.
"""

    client = OpenAI(os.getenv("OPENAI_API_KEY"))

    try:
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are Nova, a smart and helpful AI assistant for project creators."},
                {"role": "user", "content": prompt}
            ],
            max_tokens=300
        )
        return jsonify({'response': response.choices[0].message.content}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500