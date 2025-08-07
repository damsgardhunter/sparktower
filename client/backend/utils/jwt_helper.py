from flask_jwt_extended import create_access_token, create_refresh_token, set_access_cookies, set_refresh_cookies, unset_jwt_cookies

def generate_token(identity):
    return create_access_token(identity=str(identity))

def generate_refresh_token(identity):
    return create_refresh_token(identity=identity)

def set_token_cookies(response, access_token, refresh_token=None):
    set_access_cookies(response, access_token)
    if refresh_token:
        set_refresh_cookies(response, refresh_token)
    return response

def clear_token_cookies(response):
    unset_jwt_cookies(response)
    return response