export interface ServerConnection {
  baseUrl: string;
  token: string | null;
}

let connection: ServerConnection = {
  baseUrl: process.env.TEAMAI_SERVER_URL ?? "http://localhost:8787",
  token: null,
};

export function getConnection(): ServerConnection {
  return connection;
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${connection.baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
