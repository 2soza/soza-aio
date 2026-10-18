<h1 align="center" style="font-family: Arial, sans-serif; color: #FF6F61; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
  ALL IN ONE BOT 1.4.1.0
</h1>

<h2>Discord All-in-One BOT Installation Guide</h2>

<h3>How to Install</h3>

<h4>Step 1: Configure environment variables</h4>

<ol>
   <li>Set the variables in your hosting provider. Do not commit tokens, API keys, or database credentials to <code>config.json</code>. Public Spotify links played with <code>.play</code> or <code>/music play</code> do not require Spotify credentials, but Spotify API credentials are needed to load every track from large albums or playlists.</li>
</ol>

<h4>ENV SETUP</h4>

<pre>
TOKEN=
FACEBOOK_ACCESS_TOKEN=
FORTNITE_API_KEY=
YOUTUBE_API_KEY=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
TWITCH_CLIENT_ID=
TWITCH_ACCESS_TOKEN=
INSTAGRAM_ACCESS_TOKEN=
MONGODB_URI=
GEMINI_API_KEY=
DISCORD_USER_ID=
BOT_API=
DISCORD_GUILD_ID=
REQUIRE_BOT_VERIFICATION=false
MUSIC_DEFAULT_VOLUME=90
</pre>

<h4>Step 2: Set Up Hosting Service</h4>

<ol>
  <li>Create a new service in <a href="https://railway.com/">Railway</a> from this repository.</li>
  <li>Railway will use <code>railway.json</code> and install the project with pnpm.</li>
  <li>Add at least <code>TOKEN</code>, <code>MONGODB_URI</code>, and the global <code>GEMINI_API_KEY</code> in the service Variables.</li>
  <li>Set <code>DISCORD_GUILD_ID</code> to your server ID so slash commands appear immediately while deploying. Without it, Discord registers them globally and propagation can take up to an hour.</li>
</ol>

<h4>Step 3: Add Build and Start Commands</h4>
<pre>
Run the following commands to install dependencies and start your bot:

pnpm install
pnpm start
</pre>

<h4>Step 4: Get Your Bot Token</h4>
<ol>
  <li>Navigate to the Discord Developer Portal.</li>
  <li>Find your application, and retrieve the bot token from the "Bot" section.</li>
</ol>

<h4>Step 5: Set Environment Variable</h4>
<ol>
  <li>Create an environment variable with the following details:</li>
  <ul>
    <li>Key: TOKEN</li>
    <li>Value: [your bot token]</li>
  </ul>
  <li>Deploy your application using your hosting service’s deployment process.</li>
</ol>

<h4>Step 6: Wait and Test</h4>
<ol>
  <li>Wait approximately five minutes for your bot to deploy and start up.</li>
  <li>Test your bot by sending commands to ensure it is operational.</li>
</ol>

<p>🎉 Congratulations! Your bot is now up and running. 🥳</p>

<h3>Additional Resources</h3>
<p><strong>Video Tutorial:</strong> If you prefer a video guide, watch this YouTube tutorial [ Soon ].</p>
<p><strong>Common Errors:</strong> Consult the errors section for troubleshooting.</p>

<h3>Useful Files</h3>
<ul>
  <li><code>UI/banners/musicard.js</code>: Change, add, or remove music cards here.</li>
  <li><code>UI/icons/musicicons.js</code>: Change, add, or remove music icons here.</li>
</ul>
