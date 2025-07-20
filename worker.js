// Import Octokit for easier GitHub API interaction
import { Octokit } from "https://cdn.skypack.dev/@octokit/rest";

export default {
    async fetch(request, env, ctx) {
        // Handle CORS preflight requests
        if (request.method === "OPTIONS") {
            return handleOptions(request);
        }

        if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 });
        }

        try {
            const { repo, password, files, author } = await request.json();

            // 1. Authenticate the user (Teacher)
            const authorized = await verifyPassword(password, env.TEACHER_PASS_HASH);
            if (!authorized) {
                return jsonResponse({ status: 'error', message: 'Invalid password' }, 401);
            }

            // 2. Authenticate with GitHub
            const octokit = new Octokit({ auth: env.GITHUB_PAT });
            const owner = env.GITHUB_USERNAME; // You should set this in Cloudflare secrets

            // 3. Get the latest commit and tree SHA
            const { data: refData } = await octokit.rest.git.getRef({
                owner,
                repo,
                ref: 'heads/main', // Or your default branch
            });
            const latestCommitSha = refData.object.sha;

            const { data: commitData } = await octokit.rest.git.getCommit({
                owner,
                repo,
                commit_sha: latestCommitSha,
            });
            const baseTreeSha = commitData.tree.sha;

            // 4. Create blobs for each file
            const fileBlobs = await Promise.all(
                Object.entries(files).map(async ([path, content]) => {
                    // if path is data.json, content is string. Otherwise, it's base64.
                    const isJson = path.toLowerCase().endsWith('.json');
                    const encoding = isJson ? 'utf-8' : 'base64';
                    
                    const { data: blobData } = await octokit.rest.git.createBlob({
                        owner,
                        repo,
                        content: content,
                        encoding: encoding,
                    });
                    return {
                        path: path,
                        mode: '100644', // file
                        type: 'blob',
                        sha: blobData.sha,
                    };
                })
            );

            // 5. Create a new tree
            const { data: treeData } = await octokit.rest.git.createTree({
                owner,
                repo,
                base_tree: baseTreeSha,
                tree: fileBlobs,
            });

            // 6. Create a new commit
            const { data: newCommitData } = await octokit.rest.git.createCommit({
                owner,
                repo,
                message: `📝 Portfolio update: ${new Date().toISOString()}`,
                tree: treeData.sha,
                parents: [latestCommitSha],
                author: {
                    name: author.name,
                    email: author.email,
                },
            });

            // 7. Update the branch reference (fast-forward)
            await octokit.rest.git.updateRef({
                owner,
                repo,
                ref: 'heads/main',
                sha: newCommitData.sha,
            });

            return jsonResponse({ status: 'ok', commit: newCommitData.sha });

        } catch (error) {
            console.error(error);
            return jsonResponse({ status: 'error', message: error.message }, 500);
        }
    },
};

// --- Helper Functions ---

async function verifyPassword(password, hash) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const calculatedHash = Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return calculatedHash === hash;
}

function jsonResponse(data, status = 200) {
    const headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*', // Be more specific in production
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
    return new Response(JSON.stringify(data, null, 2), { status, headers });
}

function handleOptions(request) {
    if (
      request.headers.get("Origin") !== null &&
      request.headers.get("Access-Control-Request-Method") !== null &&
      request.headers.get("Access-Control-Request-Headers") !== null
    ) {
      // Handle CORS preflight requests.
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*", // Or your specific domain
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400", // 24 hours
        },
      });
    } else {
      // Handle standard OPTIONS request.
      return new Response(null, {
        headers: {
          Allow: "POST, OPTIONS",
        },
      });
    }
  }