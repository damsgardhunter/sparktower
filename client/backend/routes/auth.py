from pymysql.cursors import DictCursor
from flask import Blueprint, request, jsonify, redirect, url_for, make_response, current_app
from flask_cors import cross_origin
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import jwt_required, create_access_token, set_access_cookies, unset_jwt_cookies, get_jwt_identity, create_refresh_token
from db import get_connection
import re
from flask_limiter.util import get_remote_address
from collections import defaultdict
import time
import requests

from extensions import csrf
from dotenv import load_dotenv
import os

load_dotenv()
auth = Blueprint('auth', __name__)


login_attempts = defaultdict(list)
MAX_ATTEMPTS = 5
BLOCK_TIME = 300  # seconds

@auth.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    current_user = get_jwt_identity()
    new_token = create_access_token(identity=current_user)
    resp = make_response(jsonify(msg='Token refreshed'))
    set_access_cookies(resp, new_token)
    return resp

@auth.route('/signup', methods=['POST', 'OPTIONS'])
def signup():
    if request.method == 'OPTIONS':
        return jsonify({}), 200

    print("Headers:", dict(request.headers))
    print("Raw data:", request.data)
    print("JSON parsed:", request.get_json())

    data = request.get_json()
    if not data:
        return jsonify(msg="Missing or invalid JSON"), 400

    captcha_token = data.get("captcha_token")

    # secret key: '6LdovJorAAAAAI3pemnQEbjmexhOLroqVL3WYyZQ'

    if not captcha_token:
        return jsonify(msg="Missing CAPTCHA token"), 400

    captcha_response = requests.post(
        "https://www.google.com/recaptcha/api/siteverify",
        data={
            "secret": os.getenv("SECRET_KEY"),
            "response": captcha_token
        }
    )
    captcha_result = captcha_response.json()
    print("CAPTCHA verification result:", captcha_result)
    if not captcha_result.get("success"):
        return jsonify(msg="CAPTCHA verification failed", details=captcha_result), 400

    try:
        username = data.get('username')
        email = data.get('email')
        password_input = data.get('password')

        if not username or not email or not password_input:
            return jsonify(msg="All fields (username, email, password) are required"), 400

        if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
            return jsonify(msg='Invalid email format'), 400

        if not re.match(r'^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*?&]{8,}$', password_input):
            return jsonify(msg='Password must be at least 8 characters long, include letters and numbers'), 400

        password = generate_password_hash(password_input)

        conn = get_connection()
        cursor = conn.cursor()

        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        existing = cursor.fetchone()
        if existing:
            conn.close()
            return jsonify(msg='Email already registered'), 409

        cursor.execute("INSERT INTO users (username, email, password) VALUES (%s, %s, %s)",
                       (username, email, password))
        conn.commit()
        conn.close()
        return jsonify(msg='User created'), 201

    except Exception as e:
        print("Signup error:", str(e))
        return jsonify(msg="Server error during signup", error=str(e)), 500

@csrf.exempt
@auth.route('/login', methods=['POST', 'OPTIONS'])
@cross_origin(supports_credentials=True)
def login():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    from utils.jwt_helper import generate_token, set_token_cookies

    ip = get_remote_address()
    attempts = login_attempts[ip]
    current_time = time.time()
    # Remove old attempts
    login_attempts[ip] = [t for t in attempts if current_time - t < BLOCK_TIME]

    data = request.get_json()
    csrf_token_cookie = request.cookies.get('XSRF-TOKEN') or request.cookies.get('_csrf_token')
    csrf_token_header = request.headers.get('X-XSRF-TOKEN')
    if not csrf_token_cookie or not csrf_token_header or csrf_token_cookie != csrf_token_header:
        return jsonify(msg="CSRF token mismatch"), 403

    if len(login_attempts[ip]) >= MAX_ATTEMPTS:
        return jsonify(msg='Too many failed attempts. Try again later.'), 429

    if not data:
        return jsonify(msg="Missing or invalid JSON"), 400

    captcha_token = data.get("captcha_token")
    if not captcha_token:
        return jsonify(msg="Missing CAPTCHA token"), 400

    captcha_response = requests.post(
        "https://www.google.com/recaptcha/api/siteverify",
        data={
            "secret": os.getenv("SECRET_KEY"),
            "response": captcha_token
        }
    )
    captcha_result = captcha_response.json()
    print("CAPTCHA verification result:", captcha_result)
    if not captcha_result.get("success"):
        return jsonify(msg="CAPTCHA verification failed", details=captcha_result), 400

    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify(msg="Email and password are required"), 400

    if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        return jsonify(msg='Invalid email format'), 400

    conn = get_connection()
    cursor = conn.cursor(DictCursor)
    cursor.execute("SELECT id, password FROM users WHERE email = %s", (email,))
    existing = cursor.fetchone()
    if existing and 'password' in existing and check_password_hash(existing['password'], password):
        user_id = existing['id']
        token = generate_token(str(user_id))
        resp = make_response(jsonify(msg='Login successful'))
        set_token_cookies(resp, token)
        login_attempts[ip].clear()
        conn.close()
        return resp

    login_attempts[ip].append(current_time)
    conn.close()
    return jsonify(msg='Invalid credentials'), 401

from flask_dance.contrib.google import make_google_blueprint, google

google_bp = make_google_blueprint(client_id="XXX", client_secret="XXX", redirect_url="/oauth2callback")

@auth.route("/google_login")
def google_login():
    if not google.authorized:
        return redirect(url_for("google.login"))
    
    resp = google.get("/oauth2/v2/userinfo")
    if not resp.ok:
        return jsonify(msg='Failed to fetch user info'), 400
    
    user_info = resp.json()
    email = user_info["email"]
    username = user_info.get("name", email.split('@')[0])
    
    conn = get_connection()
    cursor = conn.cursor()
    # Check if user exists
    cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
    user = cursor.fetchone()
    
    # If not, create user
    if not user:
        cursor.execute("INSERT INTO users (username, email, password) VALUES (%s, %s, %s)", 
                       (username, email, None))  # No password for Google signups
        conn.commit()
        cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
        user = cursor.fetchone()

    # Generate token
    token = create_access_token(identity=user[0])
    resp = make_response(jsonify(msg='Login successful'))
    set_access_cookies(resp, token, max_age=3600, httponly=True, secure=True, samesite="Strict")
    conn.commit()
    conn.close()
    return resp

@auth.route('/logout', methods=['POST'])
def logout():
    resp = make_response(jsonify(msg='Logged out'))
    unset_jwt_cookies(resp)
    return resp

@auth.route('/protected', methods=['GET'])
@jwt_required()
def protected():
    return jsonify(msg='Access granted'), 200

@auth.route('/test_db')
def test_db():
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("SHOW TABLES")
        tables = cursor.fetchall()
        conn.close()
        return jsonify(tables=tables), 200
    except Exception as e:
        return jsonify(error=str(e)), 500