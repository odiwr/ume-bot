// UME Discord Radio Bot - main.js
require('dotenv').config({ path: __dirname + '/.env' });
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const { parseFile } = require('music-metadata');
const ffmpeg = require('fluent-ffmpeg');

process.env.RADIO_PATH ||= path.join(__dirname, 'radio');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const genres = ['bossa', 'jazz', 'underground', 'city'];
let currentGenreIndex = 0;
let genreRotation = shuffle([...genres]);
let currentTrackPath = null;
let currentResource = null;
const ADMIN_ROLE_NAME = "Directors"; // ✅ Role required to adjust volume

const musicPath = path.join(process.env.RADIO_PATH, 'music');
const voicePath = path.join(process.env.RADIO_PATH, 'voice');

const player = createAudioPlayer();

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
    if (!guild) return console.error("Guild not found.");

    const channel = await guild.channels.fetch(process.env.VOICE_CHANNEL_ID).catch(() => null);
    if (!channel || channel.type !== 2) return console.error("Voice channel not found or is not a voice channel.");

    joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator
    }).subscribe(player);

    playNextGenre();
});

client.on('messageCreate', async (msg) => {
    if (msg.content === '*song' && currentTrackPath) {
        try {
            const metadata = await parseFile(currentTrackPath);
            const title = metadata.common.title || path.basename(currentTrackPath);
            const artist = metadata.common.artist || 'Unknown Artist';
            const cover = metadata.common.picture?.[0];

            const responses = [
                `🎶 Currently spinning: **${title}** by **${artist}**~ yuh!`,
                `☁️ Now playing: **${title}** by **${artist}**~`,
                `🌸 You're listening to: **${title}** by **${artist}**!`,
                `🎧 This track is by **${artist}**... it's called **${title}**!`,
                `🍡 Ume's choice: **${title}** by **${artist}**!`,
                `💫 Floating to the tune of **${title}** by **${artist}**!`,
                `🐾 Wow! It's **${title}** by **${artist}** playing now~`,
                `✨ You're vibing with **${title}** by **${artist}**`,
                `🎀 Playing: **${title}** by the lovely **${artist}**`,
                `🎵 Melody on deck: **${title}** — **${artist}**`
            ];

            const message = responses[Math.floor(Math.random() * responses.length)];

            if (cover) {
                const buffer = Buffer.from(cover.data);
                const attachment = new AttachmentBuilder(buffer, { name: 'cover.jpg' });
                msg.channel.send({ content: message, files: [attachment] });
            } else {
                msg.channel.send(message);
            }
        } catch (err) {
            msg.channel.send("Couldn't read song metadata. Ume is sad");
        }
    }

        // 🔊 Volume Control Command
    if (msg.content.startsWith('*volume')) {
        if (!msg.member.roles.cache.some(role => role.name === ADMIN_ROLE_NAME)) {
            return msg.reply("⛔ Only users with the Admin role can adjust Ume’s volume!");
        }

        const parts = msg.content.split(' ');
        const level = parseFloat(parts[1]);

        if (isNaN(level) || level < 0 || level > 1) {
            return msg.reply("❗ Please provide a volume between `0.0` and `1.0`. Example: `*volume 0.3`");
        }

        if (!currentResource || !currentResource.volume) {
            return msg.reply("⚠️ No track is currently playing.");
        }

        currentResource.volume.setVolume(level);
        msg.reply(`🔊 Volume updated to **${level}**!`);
    }

});

function playNextGenre() {
    const genre = genreRotation[currentGenreIndex];
    const musicFolder = path.join(musicPath, genre);
    const voiceFolder = path.join(voicePath, genre);

    const songs = shuffle(fs.readdirSync(musicFolder).filter(f => f.endsWith('.mp3')));
    const voiceLines = fs.existsSync(voiceFolder) ? fs.readdirSync(voiceFolder).filter(f => f.endsWith('.mp3')) : [];

    if (songs.length === 0) {
        console.warn(`⚠️ No songs found in ${musicFolder}. Skipping genre...`);
        currentGenreIndex = (currentGenreIndex + 1) % genreRotation.length;
        if (currentGenreIndex === 0) genreRotation = shuffle([...genres]);
        return playNextGenre();
    }

    const count = Math.floor(Math.random() * 9) + 10;
    const queue = [...Array(count).keys()].map(i => path.join(musicFolder, songs[i % songs.length]));

    function playWithTransition(index = 0) {
        if (index === 0 && voiceLines.length) {
            const voiceLine = path.join(voiceFolder, voiceLines[Math.floor(Math.random() * voiceLines.length)]);
            playAudio(voiceLine, 1, () => playWithTransition(0));
            return;
        }
        if (index >= queue.length) {
            currentGenreIndex = (currentGenreIndex + 1) % genreRotation.length;
            if (currentGenreIndex === 0) genreRotation = shuffle([...genres]);
            return playNextGenre();
        }
        currentTrackPath = queue[index];
        playAudio(currentTrackPath, 6, () => playWithTransition(index + 1));
    }

    playWithTransition();
}

function playAudio(filePath, fadeSec, onFinish) {
  if (!fs.existsSync(filePath)) {
    console.warn(`❌ Missing file: ${filePath}`);
    return onFinish();
  }

  parseFile(filePath).then(metadata => {
    const duration = metadata.format.duration;
    const fadeOutStart = Math.max(0, duration - fadeSec);

    const ffmpegCommand = ffmpeg({ source: filePath })
      .audioFilters([
        `afade=t=in:ss=0:d=${fadeSec}`,
        `afade=t=out:st=${fadeOutStart}:d=${fadeSec}`
      ])
      .format('s16le')
      .audioChannels(2)
      .audioFrequency(48000)
      .outputOptions('-vn')
      .on('start', cmd => console.log(`🎧 FFmpeg started: ${cmd}`))
      .on('error', (err, stdout, stderr) => {
        console.error('🔥 FFmpeg error:', err.message);
        console.error(stderr);
        onFinish();
      });

    const stream = ffmpegCommand.pipe();
    const resource = createAudioResource(stream, {
        inputType: StreamType.Raw,
        inlineVolume: true
    });

    resource.volume.setVolume(0.4); // ✅ Default volume
    currentResource = resource;      // ✅ Save for volume control

    player.play(resource);
    player.once(AudioPlayerStatus.Idle, onFinish);
  }).catch(err => {
    console.error('❌ Metadata error:', err.message);
    onFinish();
  });
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

client.login(process.env.DISCORD_TOKEN);
