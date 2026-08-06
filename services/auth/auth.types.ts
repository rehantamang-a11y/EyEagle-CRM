export type AuthRole = string;

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: AuthRole[];
  permissions: string[];
};

export type AuthSession = {
  user: AuthUser;
  accessToken?: string;
  refreshToken?: string;
};

export type LoginCredentials = {
  email: string;
  password: string;
};
