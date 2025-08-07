

from flask import Blueprint, jsonify

test_openai_bp = Blueprint('test_openai', __name__)

@test_openai_bp.route('/test-openai', methods=['GET'])
def test_openai():
    return jsonify({'message': 'OpenAI test endpoint is working!'})