from flask import Flask, request
import os
from routes.auth import auth, google_bp
from datetime import timedelta
from flask_jwt_extended import JWTManager
from flask_limiter import Limiter
from flask_seasurf import SeaSurf
from flask_limiter.util import get_remote_address
from db import get_connection
from flask_cors import CORS, cross_origin
from extensions import csrf
from projects.create import test_openai_bp


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "http://localhost:3000"}}, supports_credentials=True)

app.secret_key = "1234_5678_abcd"
csrf.init_app(app)

@csrf.exempt
@app.before_request
def handle_options_requests():
    if request.method == "OPTIONS":
        return '', 200

app.config['JWT_COOKIE_SECURE'] = True 
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(hours=1)
app.config["RECAPTCHA_SECRET_KEY"] = os.getenv("RECAPTCHA_SECRET_KEY")
app.register_blueprint(test_openai_bp)

# Extensions
jwt = JWTManager(app)
limiter = Limiter(get_remote_address, app=app)

app.register_blueprint(auth, url_prefix="/auth")
app.register_blueprint(google_bp, url_prefix="/login")

@app.after_request
def after_request(response):
    token = csrf._get_token()
    response.set_cookie(
        'XSRF-TOKEN',
        token,
        secure=False,       # True in production
        httponly=False,     # So JS can read it
        samesite='Lax'
    )
    print(f"Response headers: {response.headers}")
    return response

@csrf.exempt
@cross_origin(origins="http://localhost:3000", supports_credentials=True)
@app.route('/', methods=["GET"])
def csrf_test():
    return "Hello, CSRF is enabled!"
