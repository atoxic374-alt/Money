require('events').EventEmitter.defaultMaxListeners = 0;


const {
    Client,
    EmbedBuilder,
    Collection,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ActivityType,
    PermissionFlagsBits
} = require('discord.js');

const fs = require('fs');
const { Poru } = require('poru');

const { Colors, owners, TwitchUrl, statuses } = require(`${process.cwd()}/settings/config`);
const { getVoiceConnection } = require('@discordjs/voice');
const duratiform = require('duratiform');

const runningBots = new Collection();
const tempData = new Collection();
tempData.set("bots", []);
const collection = new Collection();
const artistTracksCache = new Collection();
const nowPlayingMessages = new Collection();
const voiceReconnectState = new Collection();
const VOICE_RETRY_BASE_MS = 15000;
const VOICE_RETRY_MAX_MS = 300000;

function getVoiceRetryDelay(attempts) {
    return Math.min(VOICE_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempts - 1)), VOICE_RETRY_MAX_MS);
}


module.exports = {
    runsys: async function runBotSystem(token, idbot) {
        if (runningBots.has(token)) {
            return runningBots.get(token);
        }
        let hostConfig;
        try {
            const data = fs.readFileSync('./settings/host.json', 'utf8');
            hostConfig = JSON.parse(data);
        } catch (error) {
            return;
        }

        const TrueMusic = new Client({
            shards: "auto",
            allowedMentions: {
                parse: ["roles", "users", "everyone"],
                repliedUser: false,
            },
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildVoiceStates,
            ],
        });


        runningBots.set(token, TrueMusic);

        TrueMusic.poru = new Poru(TrueMusic, hostConfig, {
            defaultPlatform: 'ytsearch',
            reconnectTries: 20,
            reconnectTimeout: 3000,
            library: 'discord.js',
            autoResume: false,
        });

        const patchPoruRestJson = (node) => {
            if (!node?.rest || node.rest.__moneyJsonPatch) return;

            const originalGet = node.rest.get.bind(node.rest);
            node.rest.get = async (path) => {
                const response = await originalGet(path);
                if (typeof response !== 'string') return response;

                const trimmed = response.trim();
                if (!trimmed || !['{', '['].includes(trimmed[0])) return response;

                try {
                    return JSON.parse(trimmed);
                } catch {
                    return response;
                }
            };

            node.rest.__moneyJsonPatch = true;
        };

        // ✅ Required for Lavalink/Poru voice handshake (VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE).
        // Lavalink needs both packets to build { token, endpoint, sessionId } for Discord voice.
        TrueMusic.on('raw', (packet) => {
            if (!['VOICE_STATE_UPDATE', 'VOICE_SERVER_UPDATE'].includes(packet?.t)) return;

            try {
                TrueMusic.poru.packetUpdate(packet);
            } catch (error) {
                console.warn(`[Voice] Failed to forward ${packet?.t || 'unknown'} to Poru: ${error.message}`);
            }
        });

        TrueMusic.poru.on('nodeConnect', (node) => {
            patchPoruRestJson(node);

            let newData = tempData.get("bots");
            newData.push(TrueMusic);
            tempData.set("bots", newData);

            let botNumber = newData.indexOf(TrueMusic) + 1;
            console.log(`\x1b[33m${botNumber}\x1b[0m | ${TrueMusic.user?.username || 'Unknown'} | Connected \x1b[32m${node.options.host}\x1b[0m`);
        });


        TrueMusic.poru.on('nodeReconnect', patchPoruRestJson);

        const socketClosedRecovering = new Set();

        TrueMusic.poru.on('socketClosed', async (player, data) => {
            const { code, guildId } = data;
            const INVALID_SESSION_CODES = [4006, 4009, 4014, 4015];
            if (!INVALID_SESSION_CODES.includes(code)) return;

            const recoveryKey = `${TrueMusic.user?.id}:${guildId}`;
            if (socketClosedRecovering.has(recoveryKey)) return;
            socketClosedRecovering.add(recoveryKey);

            console.warn(`[Voice] socketClosed ${code} guild=${guildId} — rejoining with fresh session`);

            try {
                const guild = TrueMusic.guilds.cache.get(guildId);
                if (!guild) { socketClosedRecovering.delete(recoveryKey); return; }

                const voiceChannelId = player.voiceChannel;
                const textChannelId  = player.textChannel;
                const currentTrack   = player.currentTrack;
                const savedQueue     = player.queue ? [...player.queue] : [];
                const group          = token;

                player.destroy();

                await new Promise(res => setTimeout(res, 2500));

                if (!voiceChannelId) { socketClosedRecovering.delete(recoveryKey); return; }

                const voiceChannel = guild.channels.cache.get(voiceChannelId);
                if (!voiceChannel) { socketClosedRecovering.delete(recoveryKey); return; }

                const newPlayer = await TrueMusic.poru.createConnection({
                    guildId: guild.id,
                    voiceChannel: voiceChannelId,
                    textChannel: textChannelId,
                    deaf: true,
                    group,
                });

                if (currentTrack) {
                    if (savedQueue.length > 0) newPlayer.queue.add(...savedQueue);
                    newPlayer.queue.unshift(currentTrack);
                    newPlayer.play();
                    console.log(`[Voice] Resumed playback after 4006 recovery guild=${guildId}`);
                }
            } catch (err) {
                console.error(`[Voice] Recovery from ${code} failed guild=${guildId}: ${err.message}`);
            } finally {
                setTimeout(() => socketClosedRecovering.delete(recoveryKey), 10000);
            }
        });

        // ── trackError: إعادة محاولة من SoundCloud عند فشل YouTube ─────────────
        TrueMusic.poru.on('trackError', async (player, track, error) => {
            const title      = track?.info?.title || 'Unknown';
            const errMsg     = error?.error || error?.message || JSON.stringify(error);
            const isYouTube  = track?.info?.sourceName === 'youtube';

            console.error(`[Track] Error "${title}" (${track?.info?.sourceName}): ${errMsg}`);

            // YouTube فشل → جرب SoundCloud كاحتياط
            if (isYouTube && title && title !== 'Unknown') {
                try {
                    const fallback = await TrueMusic.poru.resolve({ query: title, source: 'scsearch' });
                    if (fallback?.tracks?.length > 0) {
                        const ft = fallback.tracks[0];
                        ft.info.requester = track.info.requester;
                        player.queue.unshift(ft);
                        await player.skip();
                        console.log(`[Track] Fallback SoundCloud: "${ft.info.title}"`);
                        return;
                    }
                } catch { /* skip fallback silently */ }
            }

            // لا احتياط → انتقل للأغنية التالية أو أوقف
            try {
                if (player.queue.length > 0) {
                    await player.skip();
                } else {
                    await player.destroy();
                }
            } catch { /* silent */ }
        });

        // ── trackStuck: الأغنية توقفت بدون سبب → انتقل للتالية ───────────────
        TrueMusic.poru.on('trackStuck', async (player, track) => {
            console.warn(`[Track] Stuck: "${track?.info?.title}" guild=${player.guildId}`);
            try {
                if (player.queue.length > 0) {
                    await player.skip();
                } else {
                    await player.destroy();
                }
            } catch (e) {
                console.error(`[Track] Stuck recovery error: ${e.message}`);
            }
        });

        // ── nodeError / nodeDisconnect: تسجيل أخطاء الاتصال ──────────────────
        TrueMusic.poru.on('nodeError', (node, error) => {
            console.error(`[Lavalink] Node error on ${node.options.host}: ${error?.message || error}`);
        });

        TrueMusic.poru.on('nodeDisconnect', (node, code, reason) => {
            console.warn(`[Lavalink] Node disconnected ${node.options.host} — code=${code} reason=${reason || 'none'}`);
        });

        TrueMusic.on('guildCreate', async (guild) => {
            let dataaa;
            try {
                dataaa = fs.readFileSync('./settings/tokens.json', 'utf8');
                dataaa = JSON.parse(dataaa);
            } catch (error) {
                return;
            }

            let tokenObj = dataaa.find((tokenBot) => tokenBot.token === TrueMusic.token);

            if (!tokenObj) {
                return;
            }

            if (guild.id !== tokenObj.Server) {
                if (guild.ownerId !== TrueMusic.user.id) {
                    try {
                        await guild.leave();
                        console.log(`Left guild: ${guild.name}`);
                    } catch (error) {
                    }
                }
            }
        });

        let lastVCStatus = null;

        TrueMusic.once('ready', async () => {
            TrueMusic.poru.init(TrueMusic);
            collection.set(TrueMusic.user.id, TrueMusic);

            TrueMusic.poru.players.forEach(player => {
                player.queue.clear();
                if (player.isPlaying) {
                    player.stop();
                }
            });

            let int = setInterval(async () => {
                if (!TrueMusic.readyAt) return;

                let dataaa;
                try {
                    dataaa = fs.readFileSync('./settings/tokens.json', 'utf8');
                    dataaa = JSON.parse(dataaa);
                } catch (error) {
                    return;
                }

                let tokenObj = dataaa.find((tokenBot) => tokenBot.token === token);

                if (!tokenObj) {
                    await TrueMusic.destroy().catch(() => 0);
                    runningBots.delete(token);
                    return clearInterval(int);
                }

                if (tokenObj.expireDate <= Date.now()) {
                    await TrueMusic.destroy().catch(() => 0);
                    runningBots.delete(token);
                    return clearInterval(int);
                }

                if (tokenObj.channel) {
                    let guild = TrueMusic.guilds.cache.get(tokenObj.Server);
                    if (guild) {
                        const musicChannel = guild.channels.cache.get(tokenObj.channel);
                        if (musicChannel) {
                            const currentVC = guild.members.me.voice.channel;

                            if (!currentVC || currentVC.id !== musicChannel.id) {
                                const retryKey = `${TrueMusic.user.id}:${guild.id}`;
                                const retryState = voiceReconnectState.get(retryKey) || { attempts: 0, nextRetryAt: 0 };
                                const existingPlayer = TrueMusic.poru.players.get(guild.id);
                                const now = Date.now();

                                if (existingPlayer && retryState.attempts > 0 && now < retryState.nextRetryAt) return;
                                if (!existingPlayer && now < retryState.nextRetryAt) return;
                                if (existingPlayer) existingPlayer.destroy();

                                if (!TrueMusic.readyAt) return;

                                try {
                                    await TrueMusic.poru.createConnection({
                                        guildId: guild.id,
                                        voiceChannel: musicChannel.id,
                                        textChannel: tokenObj.chat || musicChannel.id,
                                        deaf: true,
                                        group: tokenObj.token,
                                    });
                                    voiceReconnectState.delete(retryKey);
                                } catch (err) {
                                    const attempts = retryState.attempts + 1;
                                    const delay = getVoiceRetryDelay(attempts);
                                    voiceReconnectState.set(retryKey, {
                                        attempts,
                                        nextRetryAt: Date.now() + delay,
                                    });
                                    console.warn(`[Voice] Join failed guild=${guild.id}; retry in ${Math.round(delay / 1000)}s: ${err.message}`);
                                }
                            } else {
                                voiceReconnectState.delete(`${TrueMusic.user.id}:${guild.id}`);
                            }
                        }
                    }
                } else {
                    let guild = TrueMusic.guilds.cache.get(tokenObj.Server);
                    if (guild) {
                        const player = TrueMusic.poru.players.get(guild.id);
                        if (player) {
                            player.destroy();
                        }
                    }
                }

                if (tokenObj.token === TrueMusic.token) {
                    const currentStatus = TrueMusic.user.presence?.activities[0]?.name;
                    const newStatus = tokenObj.status || statuses;

             if (currentStatus !== newStatus) {
  TrueMusic.user.setPresence({
    activities: [
      {
        name: String(newStatus || "Sway Music"),
        type: ActivityType.Streaming,
        url: Array.isArray(TwitchUrl) ? TwitchUrl[0] : TwitchUrl,
      },
    ],
    status: 'online',
  });
}

                }

            }, 5000);
        });








        TrueMusic.on('messageCreate', async (message) => {
            if (message.author.bot || !message.guild) return;
            var data = fs.readFileSync('./settings/tokens.json', 'utf8');
            if (data == '' || !data) return;
            data = JSON.parse(data);
            let tokenObj = data.find((t) => t.token == token);
            if (!data || !tokenObj) return;

            let args = message.content?.trim().split(' ');
            if (args) {
                const hasMention = args.includes(`<@!${TrueMusic.user.id}>`) || args.includes(`<@${TrueMusic.user.id}>`);
                if (hasMention) {
                    args = args.filter(arg => arg !== `<@!${TrueMusic.user.id}>` && arg !== `<@${TrueMusic.user.id}>`);

                    if (!args[0]) return;
                    if (args[0] == 'help') {
                        const botOwnerId = tokenObj.client;
                        const button1 = new ButtonBuilder()
                            .setLabel('Support Server')
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://discord.gg/QLY');

                        const row1 = new ActionRowBuilder().addComponents(button1);
                        const helpEmbed = new EmbedBuilder()
                            .setColor(Colors)

                            .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1264225405465002025/O.png?ex=669d1928&is=669bc7a8&hm=ee36f6e8facc4eb99721570bc7f32dff9551bc5bea89d7a027c09408cafba604&")
                            .setDescription(`
              \`\`\`Music Commands\`\`\`
                play [track] - \`Adds the track to the queue.\`
                search [track] - \`Searching from YouTube\`

                join - \`Joins the voice channel\`
                leave - \`Leaves the voice channel\`
                pause - \`Pauses the playback\`
                resume - \`Resumes the playback\`

                skip - \`Skips the currently playing track\`
                queue - \`Displays the current queue\`
                stop - \`Stop playing songs\`
                autoplay - \`Play songs on the first song\`
                nowplaying - \`Displays the currently playing track\`
                seek [timestamp] - \`Sets the track's position to the timestamp\`
                remove [position] - \`Removes the track from the queue\`
                loop [ON/OFF] - \`Repeat play song\`
                forward [Time] - \`Present a specific time of the song\`
                volume [volume] - \`Sets the bot's volume\`

              \`\`\`Owner Commands\`\`\`

                setname [name] - \`Sets the name of the bot\`
                setavatar [attach a picture] - \`Sets the avatar of the bot\`
                streaming - \`Sets the status the bot displays\`

                setprefix [setprefix/unsetprefix] - \`Add and delete prefix\`
                setvc [setvc/leave] - \`set the voice bot and name it as voice.\`
                settc [settc/unchat] - \`Sets the text channel for playing music\`

                mu - \`Control all bots in a server in a True\`
                restart - \`Restart the bot\`
              
              `)



                        const additionalEmbed = new EmbedBuilder()
                            .setColor(Colors)
                            .setDescription(`
                **Owner :** <@${botOwnerId}>
                **Ownerid :** \`${botOwnerId}\``);


                        message.author.send({
                            embeds: [helpEmbed, additionalEmbed],
                            components: [row1],
                        }).then(async () => {

                            const helpdma = new EmbedBuilder()
                                .setColor(Colors)
                                .setDescription(`> **تم إرسال الاوامر في الخاص.**`)
                                .setFooter({
                                    text: '𝐐𝐮𝐞𝐥𝐲 𝐒𝐭𝐨𝐫𝐞',
                                    iconURL: 'https://cdn.discordapp.com/attachments/1091536665912299530/1264377247117082624/emo2.png?ex=669da692&is=669c5512&hm=6d7ce09b35345cdfa38f5aefa67c4031c4158b9b8ef95c83ea1336e979fbc9a1&' // رابط أيقونة البوت
                                });
                            message.reply({ embeds: [helpdma] }).catch(() => 0);



                        }).catch(() => {
                            message.react("🔒").catch(() => 0);
                        });
                    }


                    if (!owners.includes(message.author.id) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                        return;
                    }
                    if (args[0] == 'restart' || args[0] == 'اعاده') {
                        await TrueMusic.destroy()
                        setTimeout(async () => {
                            TrueMusic.login(token).then(() => {
                                message.react(`💹`).catch(() => 0)
                            }).catch(() => { console.log(`${TrueMusic.user.tag} (${TrueMusic.user.id}) has an error with restarting.`) })
                        }, 5000)

                    } else if (args[0] == 'setname' || args[0] == 'اسم' || args[0] == 'name' || args[0] == 'sn') {
                        let name = args.slice(1).join(' ');
                        if (!name) return;

                        const tryChangeName = (newName, attempts = 0) => {
                            TrueMusic.user.setUsername(newName).then(async () => {
                                message.react('✅').catch(() => 0);
                            }).catch((error) => {
                                if (error.code === 50035) {
                                    if (attempts < 3) {
                                        const newNameWithDot = `${newName}.`;
                                        tryChangeName(newNameWithDot, attempts + 1);
                                    } else {
                                        message.react('⏳').catch(() => 0);
                                    }
                                } else {
                                    console.error(error);
                                    message.reply("An error occurred while changing the bot's name.");
                                }
                            });
                        };

                        tryChangeName(name);
                    } else if (args[0] == 'setavatar' || args[0] == 'صورة' || args[0] == 'avatar' || args[0] == 'avatar' || args[0] == 'sa') {
                        let url = args[1];
                        if (!url && !message.attachments.first()) return;

                        if (message.attachments.first()) {
                            url = message.attachments.first().url;
                        }

                        TrueMusic.user.setAvatar(url)
                            .then(() => {
                                message.react('✅').catch(() => { });
                            })
                            .catch((error) => {
                                message.react('✅').catch(() => { });
                            });

                    } else if (args[0] == 'leave' || args[0] == 'اخرج' || args[0] == 'اطلع' || args[0] == 'disablechannel') {
                        let data = fs.readFileSync('./settings/tokens.json');
                        data = JSON.parse(data);
                        tokenObj = data.find((tokenBot) => tokenBot.token == token);
                        data = data.map((tokenBot) => {
                            if (tokenBot.token == token) {
                                tokenBot.channel = null;
                            }
                            return tokenBot;
                        });
                        fs.writeFile('./settings/tokens.json', JSON.stringify(data, null, 2), (err) => {
                            if (err) throw err;
                        });
                        message.react('✅');
                    }
                    else if (args[0] == 'setup') {
                        let channel = message.member.voice.channel;
                        if (!channel) return;

                        data = data.map((tokenBot) => {
                            if (tokenBot.token == token) {
                                tokenBot.channel = channel.id;
                            }
                            return tokenBot;
                        });

                        const cooldownTime = 5000;
                        const lastChangeTime = TrueMusic.user.lastChangeTime || 0;
                        const currentTime = Date.now();
                        if (currentTime - lastChangeTime < cooldownTime) {
                            return message.react('⏳');
                        }

                        try {
                            await TrueMusic.user.setUsername(channel.name);
                            TrueMusic.user.lastChangeTime = Date.now();
                            fs.writeFile('./settings/tokens.json', JSON.stringify(data, null, 2), (err) => {
                                if (err) throw err;
                            });
                            message.react('✅');
                        } catch (error) {
                            if (error.code === 50035) {
                                return message.reply('> **Please try to change the name later.**');
                            } else {
                                console.error(error);
                            }
                        }

                    } else if (args[0] == 'join' || args[0] == 'come' || args[0] == 'setvc' || args[0] == 'ادخل' || args[0] == 'تعال') {

                        let channel = message.member.voice.channel;
                        if (!channel) return;

                        data = data.map((tokenBot) => {
                            if (tokenBot.token == token) {
                                tokenBot.channel = channel.id;
                            }
                            return tokenBot;
                        });

                        fs.writeFile('./settings/tokens.json', JSON.stringify(data, null, 2), (err) => {
                            if (err) throw err;
                        });

                        message.react('✅');
                    }

                    else if (args[0] == 'setchat' || args[0] == 'chat' || args[0] == 'settc' || args[0] == 'اوامر') {
                        let data = fs.readFileSync('./settings/tokens.json', 'utf8');
                        let parsedData = JSON.parse(data);

                        tokenObj = parsedData.find((tokenBot) => tokenBot.token == token);

                        if (!tokenObj) return;

                        let channel = message.guild.channels.cache.get(message.channel.id);

                        if (!channel) return;

                        parsedData = parsedData.map((tokenBot) => {
                            if (tokenBot.token == token) {
                                tokenBot.chat = channel.id;
                            }
                            return tokenBot;
                        });

                        fs.writeFile('./settings/tokens.json', JSON.stringify(parsedData, null, 2), (err) => {
                            if (err) throw err;
                            message.react('✅');
                        });

                    } else if (args[0] == 'unchat' || args[0] == 'unt' || args[0] == 'الغاء') {
                        let data = fs.readFileSync('./settings/tokens.json', 'utf8');
                        let parsedData = JSON.parse(data);

                        tokenObj = parsedData.find((tokenBot) => tokenBot.token == token);

                        if (!tokenObj) return;

                        let channelId = tokenObj.chat;
                        if (!channelId) return message.reply('> **There is no specific command chat.**');

                        parsedData = parsedData.map((tokenBot) => {
                            if (tokenBot.token == token) {
                                delete tokenBot.chat;
                            }
                            return tokenBot;
                        });

                        fs.writeFile('./settings/tokens.json', JSON.stringify(parsedData, null, 2), (err) => {
                            if (err) throw err;
                            message.react('✅');
                        });
                        loadPrefix();

                    } else if (args[0] == 'ping' || args[0] == 'بنج' || args[0] == 'بنغ') {
                        const ping = TrueMusic.ws.ping;
                        message.reply(`> **ϟ Pong! My ping is \`${ping}ms.\`**`);

                    } else if (args[0] == 'setstreaming' || args[0] == 'streaming' || args[0] == 'ste' || args[0] == 'ستريمنج') {
                        let status = message.content.split(" ")[2];
                        if (!status) return message.react("❌");
                        TrueMusic.user.setPresence({
                            activities: [
                                {
                                    name: status,
                                    type: 'STREAMING',
                                    url: "https://twitch.tv/" + status,
                                },
                            ],
                            status: 'online',
                        });
                        message.react("✅");

                        let tokens = fs.readFileSync('./settings/tokens.json');
                        tokens = JSON.parse(tokens);
                        let tokenObj = tokens.find((tokenBot) => tokenBot.token == token);
                        tokenObj.status = status;
                        fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2));
                    } else if (args[0] == 'setprefix') {
                        if (!args[1]) return message.reply("> **Please write the prefix**");

                        let newPrefix = args[1];

                        let data = fs.readFileSync('./settings/tokens.json', 'utf8');
                        let parsedData = JSON.parse(data);
                        let tokenObj = parsedData.find((tokenBot) => tokenBot.token === token);
                        if (tokenObj) {
                            tokenObj.prefix = newPrefix;
                        } else {
                            parsedData.push({ token, prefix: newPrefix });
                        }
                        fs.writeFileSync('./settings/tokens.json', JSON.stringify(parsedData, null, 2));

                        message.reply(`> **The prefix has been determined.** \`${newPrefix}\``);

                    } else if (args[0] === 'unsetprefix') {
                        let data = fs.readFileSync('./settings/tokens.json', 'utf8');
                        let parsedData = JSON.parse(data);
                        let tokenObj = parsedData.find((tokenBot) => tokenBot.token === token);
                        if (tokenObj) {
                            tokenObj.prefix = null;
                            fs.writeFileSync('./settings/tokens.json', JSON.stringify(parsedData, null, 2));
                            message.reply('> **The prefix has been removed.**');
                        }

                    }

                }
            }
        });



    TrueMusic.poru.on("queueEnd", async (player) => {
      // clear now-playing interval & disable buttons
      const stored = nowPlayingMessages.get(player.guildId);
      if (stored) {
        clearInterval(stored.intervalId);
        try { await stored.message.edit({ components: [] }); } catch {}
        nowPlayingMessages.delete(player.guildId);
      }

      if (!player?.data?.autoPlay || player.data.autoPlay === false) {
        if (player.isPlaying) player.stop();
        player.queue.clear();
        player.data.autoPlay = false;
        return;
      }
      const currentTrack = player.currentTrack;
      if (!currentTrack) {
        if (player.isPlaying) player.stop();
        player.queue.clear();
        player.data.autoPlay = false;
        return;
      }

      const search = `${currentTrack.info.title} next autoplay`;
      const res = await TrueMusic.poru.resolve({
        query: search,
      });

      if (!res || res.tracks.length === 0) {
        if (player.isPlaying) player.stop();
        player.queue.clear();
        player.data.autoPlay = false;
        return;
      }

      const nextTrack = res.tracks.find(track => track.info.uri !== currentTrack.info.uri);

      if (!nextTrack) {
        if (player.isPlaying) player.stop();
        player.queue.clear();
        player.data.autoPlay = false;
        return;
      }

      nextTrack.info.requester = currentTrack.info.requester;
      player.queue.add(nextTrack);

      if (!player.isPlaying && !player.paused) {
        player.play();
      }
    });



    TrueMusic.poru.on('trackStart', async (player, track) => {
      player.data.lastTrack = track;

      // skip first emit — play command already sends its own embed
      if (player.data.skipFirstTrackStart) {
        player.data.skipFirstTrackStart = false;
        return;
      }

      // clear any old interval
      const old = nowPlayingMessages.get(player.guildId);
      if (old) { clearInterval(old.intervalId); nowPlayingMessages.delete(player.guildId); }

      // send updated embed for skip / autoplay scenario
      try {
        const chId = typeof player.textChannel === 'string' ? player.textChannel : player.textChannel?.id;
        const ch   = TrueMusic.channels.cache.get(chId);
        if (!ch) return;

        const [row1, row2] = (() => {
          const r1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('prev').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('stop').setEmoji('⏹️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
          );
          const r2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('volume_down').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('volume_up').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
          );
          return [r1, r2];
        })();

        const filterRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('music_filter')
            .setPlaceholder('🎛️ اختر فلتر للتشغيل')
            .addOptions([
              { label: 'باس بوست',     value: 'bassboost', emoji: '🎸', description: 'تضخيم الجهير' },
              { label: 'نايت كور',     value: 'nightcore', emoji: '🌙', description: 'سرعة عالية وحدة أعلى' },
              { label: '8D صوت',       value: 'eightd',    emoji: '🎧', description: 'صوت ثلاثي الأبعاد' },
              { label: 'فيبور ويف',    value: 'vaporwave', emoji: '🌊', description: 'سرعة بطيئة وحدة أعمق' },
              { label: 'كاراوكي',      value: 'karaoke',   emoji: '🎤', description: 'إزالة الصوت' },
              { label: 'إيقاف الفلتر', value: 'none',      emoji: '❌', description: 'إلغاء الفلتر الحالي' },
            ])
        );

        const artist  = track.info.author || 'Unknown Artist';
        const totalMs = track.info.length  || 0;
        const thumb   = track.info.thumbnail || track.info.artworkUrl || null;
        const fmt = ms => `${Math.floor(ms/60000)}:${String(Math.floor((ms%60000)/1000)).padStart(2,'0')}`;
        const bar = () => {
          const p = TrueMusic.poru.players.get(player.guildId);
          const cur = p?.position || 0;
          const len = 17;
          const pos = Math.min(Math.floor((cur / totalMs) * len), len - 1);
          return '─'.repeat(pos) + '🔴' + '─'.repeat(len - 1 - pos);
        };

        const makeEmbed = (curMs = 0) => {
          const e = new EmbedBuilder()
            .setColor(Colors)
            .setDescription(`### [${track.info.title}](${track.info.uri})\n\`${fmt(curMs)}\` ${bar()} \`${fmt(totalMs)}\``)
            .setFooter({ text: `🎤  ${artist}` });
          if (thumb) e.setThumbnail(thumb);
          return e;
        };

        const sentMsg = await ch.send({ embeds: [makeEmbed(0)], components: [row1, row2, filterRow] });

        const intervalId = setInterval(async () => {
          const p = TrueMusic.poru.players.get(player.guildId);
          if (!p || !p.currentTrack) { clearInterval(intervalId); nowPlayingMessages.delete(player.guildId); return; }
          try { await sentMsg.edit({ embeds: [makeEmbed(p.position || 0)] }); }
          catch { clearInterval(intervalId); nowPlayingMessages.delete(player.guildId); }
        }, 15000);

        nowPlayingMessages.set(player.guildId, { message: sentMsg, intervalId });
      } catch { /* silent */ }
    });



        TrueMusic.on('messageCreate', async (message) => {
            if (message.author.bot || !message.guild) return;

            let tokenObj;
            try {
                const data = fs.readFileSync('./settings/tokens.json', 'utf8');
                if (!data.trim()) {
                    console.warn('Warning: tokens.json is empty');
                    return;
                }

                const parsedData = JSON.parse(data);
                if (!Array.isArray(parsedData)) {
                    console.warn('Warning: tokens.json is not an array');
                    return;
                }
                tokenObj = parsedData.find((tokenBot) => tokenBot.token === token);

                if (!tokenObj) {
                    console.warn('Warning: Token not found in tokens.json');
                    return;
                }
            } catch (error) {
                console.error('Error reading or parsing tokens.json:', error.message);
                return;
            }

            let memberVoice = message.member?.voice?.channel;
            if (!memberVoice) return;

            let clientVoice = message.guild.members?.me?.voice?.channel;
            if (!clientVoice || memberVoice.id !== clientVoice.id) return;

            const prefix = tokenObj.prefix || "";

            if (tokenObj.chat && message.channel.id !== tokenObj.chat) return;
            if (!message.content.startsWith(prefix)) return;

            const args = message.content.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            function createMusicControlButtons() {
                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('stop')
                            .setEmoji('⏹️')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('pause')
                            .setEmoji('⏸️')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('skip')
                            .setEmoji('⏭️')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('loop')
                            .setEmoji('🔁')
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId('volume_up')
                            .setEmoji('🔊')
                            .setStyle(ButtonStyle.Secondary),
                    );
                return row;
            }

            async function applyFilter(player, filterType) {
                try {
                    switch (filterType) {
                        case 'bassboost':
                            await player.setEQ([
                                { band: 0, gain: 0.6 }, { band: 1, gain: 0.7 },
                                { band: 2, gain: 0.8 }, { band: 3, gain: 0.55 },
                                { band: 4, gain: 0.25 }, { band: 5, gain: 0.0 },
                            ]);
                            break;
                        case 'nightcore':
                            await player.setTimescale({ speed: 1.2, pitch: 1.3, rate: 1 });
                            break;
                        case 'eightd':
                            await player.setRotation({ rotationHz: 0.2 });
                            break;
                        case 'vaporwave':
                            await player.setTimescale({ speed: 0.85, pitch: 0.8, rate: 1 });
                            break;
                        case 'karaoke':
                            await player.setKaraoke({ level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 });
                            break;
                        case 'none':
                        default:
                            await player.clearFilters();
                            break;
                    }
                } catch (e) {
                    console.error('Filter error:', e.message);
                }
            }

            function buildProgressBar(currentMs, totalMs, barLen = 17) {
                if (!totalMs || totalMs <= 0) return '─'.repeat(barLen);
                const pos = Math.min(Math.floor((currentMs / totalMs) * barLen), barLen - 1);
                return '─'.repeat(pos) + '🔴' + '─'.repeat(barLen - 1 - pos);
            }

            function buildNowPlayingEmbed(track, currentMs) {
                const artist  = track.info.author || 'Unknown Artist';
                const totalMs = track.info.length  || 0;
                const thumb   = track.info.thumbnail || track.info.artworkUrl || null;

                const fmt = ms => {
                    const m = String(Math.floor(ms / 60000));
                    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
                    return `${m}:${s}`;
                };

                const bar = buildProgressBar(currentMs, totalMs);

                const embed = new EmbedBuilder()
                    .setColor(Colors)
                    .setDescription(
                        `### [${track.info.title}](${track.info.uri})\n` +
                        `\`${fmt(currentMs)}\` ${bar} \`${fmt(totalMs)}\``
                    )
                    .setFooter({ text: `🎤  ${artist}` });

                if (thumb) embed.setThumbnail(thumb);
                return embed;
            }

            function buildControlRows() {
                const row1 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('prev').setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('stop').setEmoji('⏹️').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
                );
                const row2 = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('volume_down').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('volume_up').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
                );
                return [row1, row2];
            }

            function buildFilterRow() {
                return new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('music_filter')
                        .setPlaceholder('🎛️ اختر فلتر للتشغيل')
                        .addOptions([
                            { label: 'باس بوست',     value: 'bassboost', emoji: '🎸', description: 'تضخيم الجهير' },
                            { label: 'نايت كور',     value: 'nightcore', emoji: '🌙', description: 'سرعة عالية وحدة أعلى' },
                            { label: '8D صوت',       value: 'eightd',    emoji: '🎧', description: 'صوت ثلاثي الأبعاد' },
                            { label: 'فيبور ويف',    value: 'vaporwave', emoji: '🌊', description: 'سرعة بطيئة وحدة أعمق' },
                            { label: 'كاراوكي',      value: 'karaoke',   emoji: '🎤', description: 'إزالة الصوت' },
                            { label: 'إيقاف الفلتر', value: 'none',      emoji: '❌', description: 'إلغاء الفلتر الحالي' },
                        ])
                );
            }

            function startNowPlayingInterval(guildId, sentMsg) {
                const existing = nowPlayingMessages.get(guildId);
                if (existing) clearInterval(existing.intervalId);

                const intervalId = setInterval(async () => {
                    const p = TrueMusic.poru.players.get(guildId);
                    if (!p || !p.currentTrack) {
                        clearInterval(intervalId);
                        nowPlayingMessages.delete(guildId);
                        return;
                    }
                    try {
                        await sentMsg.edit({ embeds: [buildNowPlayingEmbed(p.currentTrack, p.position || 0)] });
                    } catch {
                        clearInterval(intervalId);
                        nowPlayingMessages.delete(guildId);
                    }
                }, 15000);

                nowPlayingMessages.set(guildId, { message: sentMsg, intervalId });
            }


            let cmdsArray = {
                play:      [`شغل`, `ش`, `p`, `play`, `P`, `Play`],
                stop:      [`stop`, `وقف`, `Stop`, `توقيف`],
                skip:      [`skip`, `سكب`, `تخطي`, `s`, `س`, `S`, `Skip`],
                volume:    [`volume`, `vol`, `صوت`, `v`, `ص`, `V`, `Vol`, `Volume`],
                nowplaying:[`nowplaying`, `np`, `Np`, `Nowplaying`, `الشغال`, `الان`],
                loop:      [`loop`, `تكرار`, `l`, `L`, `Loop`],
                pause:     [`pause`, `توقيف`, `كمل`, `pa`, `Pa`, `Pause`, `resume`],
                seek:      [`seek`, `Seek`, `se`, `Se`],
                forward:   [`forward`, `fwd`, `fw`, `تقدم`, `>>`, `أمام`],
                remove:    [`remove`, `rm`, `del`, `احذف`, `حذف`],
                autoplay:  [`autoplay`, `Autoplay`, `Ap`, `ap`],
                search:    [`search`, `ys`, `بحث`],
                queue:     [`queue`, `قائمة`, `اغاني`, `q`, `qu`, `Q`, `Qu`, `Queue`],
            };

            if (cmdsArray.play.includes(command)) {
                const song = args.join(' ');
                if (!song) {
                    const embed = new EmbedBuilder()
                        .setThumbnail('attachment://Error.png')
                        .setColor(Colors)
                        .setDescription(
                            '`play [Song]` : *Play the first result from **YouTube**\n' +
                            '`play [URL]` : *Play from **YouTube** or **SoundCloud** or Spotify*'
                        );
                    return message.channel.send({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                let player = TrueMusic.poru.players.get(message.guild.id);

                if (!player) {
                    try {
                        const voiceConnection = getVoiceConnection(message.guild.id);
                        if (voiceConnection) {
                            voiceConnection.destroy();
                            await new Promise(res => setTimeout(res, 500));
                        }
                    } catch { }

                    player = await TrueMusic.poru.createConnection({
                        guildId: message.guild.id,
                        voiceChannel: message.member.voice.channel.id,
                        textChannel: message.channel,
                        deaf: true,
                        autoPlay: false,
                    });
                  player.autoplay = false;
                
                }

                try {
                    const searchSource = tokenObj.source || 'ytsearch';

                    // جرب المصدر الأساسي، ثم احتياط SoundCloud إذا لم يُعطِ نتائج
                    let res = await TrueMusic.poru.resolve({ query: song, source: searchSource }).catch(() => null);

                    // إذا فشل البحث في يوتيوب جرب ytmsearch، ثم scsearch
                    if ((!res || !res.tracks || res.tracks.length === 0) && searchSource === 'ytsearch') {
                        res = await TrueMusic.poru.resolve({ query: song, source: 'ytmsearch' }).catch(() => null);
                    }
                    if (!res || !res.tracks || res.tracks.length === 0) {
                        res = await TrueMusic.poru.resolve({ query: song, source: 'scsearch' }).catch(() => null);
                    }

                    if (!res || !res.tracks || res.tracks.length === 0) {
                        const embed = new EmbedBuilder()
                            .setColor('#ff0000')
                            .setThumbnail('attachment://Error.png')
                            .setDescription(`*No results found for* : **${song}**`);
                        return message.reply({
                            embeds: [embed],
                            files: ['./settings/image/icons/Error.png']
                        });
                    }

                    if (res.loadType === 'playlist') {
                        const embed = new EmbedBuilder()
                            .setColor(Colors)
                            .setTitle("Playing Playlist")
                            .setThumbnail('attachment://NowPlaying.png')
                            .setDescription(`**[${res.playlistInfo.name}](${res.playlistInfo.url || res.tracks[0].info.uri})**`)
                            .setFooter({
                                text: `${message.author.displayName}`,
                                iconURL: message.author.displayAvatarURL({ dynamic: true })
                            })
                            .addFields({
                                name: "Playlist Tracks",
                                value: `**${res.tracks.length}**`,
                                inline: true
                            });

                        message.reply({
                            embeds: [embed],
                            files: ['./settings/image/icons/NowPlaying.png']
                        });

                        for (const track of res.tracks) {
                            track.info.requester = message.author;
                            player.queue.add(track);
                        }
                    } else {
                        const track = res.tracks[0];
                        track.info.requester = message.author;
                        player.queue.add(track);

                        if (player.isPlaying) {
                            const embed = new EmbedBuilder()
                                .setColor(Colors)
                                .setTitle("Add Song")
                                .setThumbnail('attachment://AddSong.png')
                                .setDescription(`**[${track.info.title}](${track.info.uri})**`)
                                .addFields({
                                    name: "Song Duration",
                                    value: `**${new Date(track.info.length).toISOString().substr(11, 8)}**`,
                                    inline: true
                                })
                                .setFooter({
                                    text: `${message.author.displayName}`,
                                    iconURL: message.author.displayAvatarURL({ dynamic: true })
                                });

                            return message.reply({
                                embeds: [embed],
                                files: ['./settings/image/icons/AddSong.png']
                            });
                        }
                    }

                    if (!player.isPlaying && !player.isPaused) {
                        player.data.skipFirstTrackStart = true;
                        player.play();
                        const track  = player.currentTrack;
                        const artist = track.info.author || 'Unknown Artist';

                        const [row1, row2]  = buildControlRows();
                        const filterRow     = buildFilterRow();
                        const replyComponents = [row1, row2, filterRow];

                        // fetch artist popular songs
                        try {
                            const artistRes   = await TrueMusic.poru.resolve({ query: `${artist} songs`, source: 'ytsearch' });
                            const artistTracks = artistRes?.tracks?.filter(t => t.info.uri !== track.info.uri)?.slice(0, 8) || [];
                            if (artistTracks.length > 0) {
                                artistTracksCache.set(message.guild.id, artistTracks);
                                const shortArtist = artist.length > 20 ? artist.slice(0, 17) + '...' : artist;
                                const artistRow   = new ActionRowBuilder().addComponents(
                                    new StringSelectMenuBuilder()
                                        .setCustomId('artist_songs')
                                        .setPlaceholder(`🎵 أغاني مشهورة لـ ${shortArtist}`)
                                        .addOptions(artistTracks.map((t, i) => {
                                            const m = String(Math.floor(t.info.length / 60000));
                                            const s = String(Math.floor((t.info.length % 60000) / 1000)).padStart(2, '0');
                                            return {
                                                label: t.info.title.length > 99 ? t.info.title.slice(0, 96) + '...' : t.info.title,
                                                value: i.toString(),
                                                description: `${m}:${s}`,
                                                emoji: '🎶'
                                            };
                                        }))
                                );
                                replyComponents.push(artistRow);
                            }
                        } catch { /* silent */ }

                        const sentMsg = await message.reply({
                            embeds: [buildNowPlayingEmbed(track, 0)],
                            components: replyComponents
                        });

                        startNowPlayingInterval(message.guild.id, sentMsg);
                    }

                } catch (error) {
                    console.error('Error searching for song:', error.message);
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://error.png')
                        .setDescription('An error occurred while searching for the song.');
                    message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/error.png']
                    });
                }
            }
            else if (cmdsArray.stop.includes(command)) {
                let player = TrueMusic.poru.players.get(message.guild.id);

                if (!player) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription(`*No music is currently playing.*`);

                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                player.setLoop('NONE');
                player.queue.clear();
                player.data.autoPlay = false;
                await player.destroy();
                message.react(`🔴`);
            }


            if (cmdsArray.nowplaying.includes(command)) {

                let player = TrueMusic.poru.players.get(message.guild.id);
                if (!player || !player.currentTrack) {
                    return message.reply(`*No music is currently playing.*`);
                }

                let memberVoice = message.member?.voice?.channel;
                let clientVoice = message.guild.members?.me?.voice?.channel;
                if (!memberVoice || !clientVoice || memberVoice.id !== clientVoice.id) return;

                const current = player.currentTrack.info;
                const loopMode = player.loop === 'TRACK' ? 'ON' : 'OFF';
                const volume = player.volume || 100;
                const currentTime = player.position;
                const totalTime = current.length;

                if (totalTime <= 0) {
                    console.error('Invalid total time');
                    return;
                }

                const progressBarLength = 20;
                const progress = Math.floor((currentTime / totalTime) * progressBarLength);
                const validProgress = Math.max(0, Math.min(progress, progressBarLength));

                const progressBar = '─'.repeat(validProgress) + '🔴' + '─'.repeat(progressBarLength - validProgress);

                const embed = new EmbedBuilder()
                    .setColor(Colors)
                    .setDescription(
                        `**Now Playing**\n` +
                        `**Title:** ${current.title}\n` +
                        `**Loop:** \`${loopMode}\` | **Volume:** \`${volume}\`\n` +
                        `**Requester:** \`${message.author.tag}\`\n\n` +
                        `\`\`\`► ${progressBar}\`\`\`\n` +
                        `\`[${duratiform.format(currentTime, 'mm:ss')} / ${duratiform.format(totalTime, 'mm:ss')}]\``
                    );

                message.channel.send({ content: `🎶 **.${message.client.user.username}**`, embeds: [embed] });
            }
            else if (cmdsArray.loop.includes(command)) {
                let player = TrueMusic.poru.players.get(message.guild.id);
                if (!player || !player.isPlaying) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription(`*No music is currently playing.*`);
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                const currentLoop = player.loop;
                const newLoopMode = currentLoop === "NONE" ? "TRACK" : "NONE";
                player.setLoop(newLoopMode);

                const embed = new EmbedBuilder()
                    .setColor(Colors)
                    .setThumbnail(`attachment://${newLoopMode === "TRACK" ? 'LoopON.png' : 'LoopOFF.png'}`)
                    .setDescription(`*Loop mode is now:* **${newLoopMode === "TRACK" ? 'ON' : 'OFF'}**`);

                return message.reply({
                    embeds: [embed],
                    files: [`./settings/image/icons/${newLoopMode === "TRACK" ? 'LoopON.png' : 'LoopOFF.png'}`]
                });
            }

            if (cmdsArray.pause.includes(command)) {
                const player = TrueMusic.poru.players.get(message.guild.id);
                if (!player || !player.currentTrack) {
                    return message.reply(`*No music is currently playing.*`);
                }

                const memberVoice = message.member.voice?.channel;
                const clientVoice = message.guild.members.me.voice?.channel;

                if (!memberVoice || !clientVoice || memberVoice.id !== clientVoice.id) return;

                if (player.isPaused) {
                    await player.pause(false);
                    message.react('▶️');
                } else {
                    await player.pause(true);
                    message.react('⏸️');
                }
            }


            else if (cmdsArray.queue.includes(command)) {
                const memberVoiceChannel = message.member?.voice?.channel;
                const botVoiceChannel = message.guild.members?.me?.voice?.channel;

                if (!memberVoiceChannel || !botVoiceChannel || memberVoiceChannel.id !== botVoiceChannel.id) return;

                const player = TrueMusic.poru.players.get(message.guild.id);
                if (!player || !player.queue || player.queue.length === 0) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription(`*No songs are currently in the queue.*`);
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                const nowPlayingTrack = player.currentTrack;
                if (!nowPlayingTrack) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription(`*No song is currently playing.*`);
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                const nowPlayingTitle = nowPlayingTrack.info.title;
                const nowPlayingDuration = duratiform.format(nowPlayingTrack.info.length, '(h:h:)(m:mm:)(s:ss)');
                const nowPlayingUrl = nowPlayingTrack.info.uri || 'No URL available';

                const itemsPerPage = 10;
                let page = 0;
                const totalTracks = player.queue.length;
                const totalPages = Math.ceil(totalTracks / itemsPerPage);

                const getQueuedTracks = () => player.queue
                    .slice(page * itemsPerPage, (page + 1) * itemsPerPage)
                    .map((track, i) => {
                        return `\`${(page * itemsPerPage) + i + 1}\` • ${track.info.title} • [\`${duratiform.format(track.info.length, '(h:h:)(m:mm:)(s:ss)')}\`] `;
                    })
                    .join('\n');

                let embed = new EmbedBuilder()
                    .setTitle(`${message.guild.name} Queue`)
                    .setDescription(`**Now Playing**\n> [${nowPlayingTitle}](${nowPlayingUrl}) • [\`${nowPlayingDuration}\`]\n\n**Queued Songs**\n${getQueuedTracks()}`)
                    .setColor(Colors);

                const menuOptions = [
                    {
                        label: 'القائمة التالية',
                        value: 'next_page',
                        emoji: '▶️'
                    },
                    {
                        label: 'القائمة السابقه',
                        value: 'previous_page',
                        emoji: '◀️'
                    },
                    {
                        label: 'حذف قائمة التشغيل',
                        value: 'clear_queue',
                        emoji: '🗑️'
                    }
                ];

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('queue_menu')
                    .setPlaceholder('اختار الخيار المُناسب لك')
                    .addOptions(menuOptions);

                const row = new ActionRowBuilder().addComponents(selectMenu);

                message.reply({ embeds: [embed], components: [row] }).catch(console.error);

                const filter = interaction => interaction.customId === 'queue_menu' && interaction.user.id === message.author.id;
                const collector = message.channel.createMessageComponentCollector({ filter, time: 30000 });

                collector.on('collect', async interaction => {
                    const selectedOption = interaction.values[0];

                    if (selectedOption === 'next_page') {
                        if (page < totalPages - 1) page++;
                    } else if (selectedOption === 'previous_page') {
                        if (page > 0) page--;
                    } else if (selectedOption === 'clear_queue') {
                        player.queue.clear();
                        await interaction.update({ content: 'The queue has been cleared!', components: [] });
                        return;
                    }

                    embed.setDescription(`**Now Playing**\n> [${nowPlayingTitle}](${nowPlayingUrl}) • [\`${nowPlayingDuration}\`]\n\n**Queued Songs**\n${getQueuedTracks()}`);
                    await interaction.update({ embeds: [embed] });
                });
            } else if (cmdsArray.skip.includes(command)) {
                let player = TrueMusic.poru.players.get(message.guild.id);

                if (!player || !player.isPlaying) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription(`*No music is currently playing.*`);
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                let memberVoice = message.member?.voice?.channel;
                let clientVoice = message.guild.members?.me?.voice?.channel;

                if (!memberVoice || !clientVoice || memberVoice.id !== clientVoice.id) return;

                const currentTrack = player.currentTrack;

                if (player.queue.length === 0) {
                    await player.destroy();
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Skip.png')
                        .setDescription(`*Skipped :* **${currentTrack.info.title}**\n_By:_ **${message.author.displayName}**`);

                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Skip.png']
                    });
                } else {
                    const skippedTrack = currentTrack;
                    await player.skip();

                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Skip.png')
                        .setDescription(`*Skipped :* **${skippedTrack.info.title}**\n_By:_ **${message.author.displayName}**`);

                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Skip.png']
                    });
                }
            }



            else if (cmdsArray.volume.includes(command)) {
                let player = TrueMusic.poru.players.get(message.guild.id);

                if (!player || !player.isPlaying) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription(`*No music is currently playing.*`);
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                let member_voice = message.member?.voice?.channel;
                let client_voice = message.guild.members?.me?.voice?.channel;

                if (!member_voice || !client_voice || member_voice.id !== client_voice.id) return;

                const args = message.content.split(' ');
                const volume = parseInt(args[1]);
                const currentVolume = player.volume || 100;

                if (isNaN(volume)) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Volumeup.png')
                        .setDescription(`**Current volume: ${currentVolume}%**`);
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Volumeup.png']
                    });
                }

                if (volume < 0 || volume > 130) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription('*Please provide a valid volume level between* **0%** *and* **130%**');
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                player.setVolume(volume);

                const embed = new EmbedBuilder()
                    .setColor(Colors)
                    .setThumbnail(`attachment://${volume < currentVolume ? 'Volumedowwn' : 'Volumeup'}.png`)
                    .setDescription(`*Volume changed from* **${currentVolume}%** *to* **${volume}%**`);

                return message.reply({
                    embeds: [embed],
                    files: [`./settings/image/icons/${volume < currentVolume ? 'Volumedowwn' : 'Volumeup'}.png`]
                });
            } else if (cmdsArray.seek.includes(command)) {
                const player = TrueMusic.poru.players.get(message.guild.id);

                if (!player || !player.currentTrack) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription(`*No music is currently playing.*`);
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                const memberVoice = message.member?.voice?.channel;
                const clientVoice = message.guild.members?.me?.voice?.channel;

                if (!memberVoice || !clientVoice || memberVoice.id !== clientVoice.id) return;

                const args = message.content.split(" ");
                const timeArg = args[1];

                if (!timeArg) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://seek.png')
                        .setDescription('*Please provide seek duration `1:11` or `90s` or `2m`*');

                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/seek.png']
                    });
                }

                let seconds = 0;
                if (timeArg.includes(":")) {
                    const [min, sec] = timeArg.split(":").map(Number);
                    seconds = (min * 60) + sec;
                } else if (timeArg.endsWith("s")) {
                    seconds = parseInt(timeArg);
                } else if (timeArg.endsWith("m")) {
                    seconds = parseInt(timeArg) * 60;
                } else {
                    seconds = parseInt(timeArg);
                }

                if (isNaN(seconds)) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://seek.png')
                        .setDescription('*Invalid time format. Please use something like `1:30` or `90s`*');

                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/seek.png']
                    });
                }

                const seekTime = Math.min(seconds * 1000, player.currentTrack.info.length);
                await player.seekTo(seekTime);

                message.react("✅").catch(() => { });
            }


            else if (cmdsArray.search.includes(command)) {
                const searchQuery = args.join(' ');
                if (!searchQuery) {
                    return message.channel.send('*Please write the name of the song*');
                }

                const selectSource = new StringSelectMenuBuilder()
                    .setCustomId('select_source')
                    .setPlaceholder('Choose a platform to search')
                    .addOptions([
                        { label: 'YouTube', value: 'ytsearch', emoji: '🎥' },
                        { label: 'SoundCloud', value: 'scsearch', emoji: '🎧' }
                    ]);

                const row = new ActionRowBuilder().addComponents(selectSource);

                const sourceMessage = await message.channel.send({
                    content: `*Choose platform to search for:* \`${searchQuery}\``,
                    components: [row]
                });

                const filter = i => i.customId === 'select_source' && i.user.id === message.author.id;
                const collector = message.channel.createMessageComponentCollector({ filter, time: 30000 });

                collector.on('collect', async interaction => {
                    const selectedSource = interaction.values[0];
                    collector.stop();

                    try {
                        const result = await TrueMusic.poru.resolve({ query: searchQuery, source: selectedSource });

                        if (!result || !result.tracks.length) {
                            return interaction.update({ content: `*No results found on ${selectedSource}.*`, components: [] });
                        }

                        const tracks = result.tracks.slice(0, 10);

                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId('song_select')
                            .setPlaceholder('Select a song')
                            .addOptions(
                                tracks.map((track, index) => {
                                    const duration = track.info.length || 0;
                                    const min = Math.floor(duration / 60000);
                                    const sec = Math.floor((duration % 60000) / 1000).toString().padStart(2, '0');
                                    return {
                                        label: track.info.title.length > 99 ? track.info.title.slice(0, 96) + "..." : track.info.title,
                                        value: index.toString(),
                                        description: `Duration: ${min}:${sec}`
                                    };
                                })
                            );

                        const newRow = new ActionRowBuilder().addComponents(selectMenu);

                        await interaction.update({
                            content: `*Select a song from the search results:*`,
                            components: [newRow]
                        });

                        const songCollector = message.channel.createMessageComponentCollector({
                            filter: i => i.customId === 'song_select' && i.user.id === message.author.id,
                            max: 1
                        });

                        songCollector.on('collect', async interaction => {
                            const selectedIndex = parseInt(interaction.values[0]);
                            const selectedTrack = tracks[selectedIndex];

                            let player = TrueMusic.poru.players.get(message.guild.id);
                            if (!player) {
                                player = await TrueMusic.poru.createConnection({
                                    guildId: message.guild.id,
                                    voiceChannel: message.member.voice.channel.id,
                                    textChannel: message.channel,
                                    deaf: true
                                });
                            }

                            selectedTrack.info.requester = message.author;
                            player.queue.add(selectedTrack);

                            if (player.isPlaying) {
                                interaction.channel.send(`*Add song:* **${selectedTrack.info.title}** _By:_ **${message.author.displayName}**`);
                            }

                            if (!player.isPlaying && !player.isPaused) {
                                player.play();
                                message.reply({
                                    content: `_Now playing:_ **${selectedTrack.info.title}** _By:_ **${message.author.displayName}**`,
                                    components: tokenObj.buttons === 'on' ? [createMusicControlButtons()] : []
                                });
                            }

                            sourceMessage.delete().catch(() => { });
                        });

                    } catch (err) {
                        console.error('Error searching for videos:', err);
                        message.channel.send('An error occurred while searching for songs.');
                    }
                });

                collector.on('end', collected => {
                    if (collected.size === 0) {
                        sourceMessage.edit({ content: `*Nothing was selected.*`, components: [] });
                    }
                });
            } else if (cmdsArray.autoplay.includes(command)) {
                let player = TrueMusic.poru.players.get(message.guild.id);

                if (!player) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription(`*No music is currently playing.*`);
                    return message.reply({
                        embeds: [embed],
                        files: ['./settings/image/icons/Error.png']
                    });
                }

                player.data.autoPlay = !player.data.autoPlay;

                const embed = new EmbedBuilder()
                    .setColor(Colors)
                    .setThumbnail('attachment://AutoPlay.png')
                    .setDescription(`*Autoplay is now* : **${player.data.autoPlay ? 'ON' : 'OFF'}**\n_By:_ **${message.author.displayName}**`);

                return message.reply({
                    embeds: [embed],
                    files: ['./settings/image/icons/AutoPlay.png']
                });

            } else if (cmdsArray.forward.includes(command)) {
                // ── forward: تقديم التشغيل بعدد ثوانٍ ─────────────────────────
                const player = TrueMusic.poru.players.get(message.guild.id);
                if (!player || !player.currentTrack) {
                    return message.reply({ content: '*No music is currently playing.*' });
                }
                const memberVoiceFwd = message.member?.voice?.channel;
                const clientVoiceFwd = message.guild.members?.me?.voice?.channel;
                if (!memberVoiceFwd || !clientVoiceFwd || memberVoiceFwd.id !== clientVoiceFwd.id) return;

                const timeArgFwd = args[0];
                if (!timeArgFwd) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setDescription('*Please provide time to forward e.g.* `forward 30s` *or* `forward 1:30`');
                    return message.reply({ embeds: [embed] });
                }

                let secFwd = 0;
                if (timeArgFwd.includes(':')) {
                    const [min, sec] = timeArgFwd.split(':').map(Number);
                    secFwd = (min * 60) + sec;
                } else if (timeArgFwd.endsWith('s')) {
                    secFwd = parseInt(timeArgFwd);
                } else if (timeArgFwd.endsWith('m')) {
                    secFwd = parseInt(timeArgFwd) * 60;
                } else {
                    secFwd = parseInt(timeArgFwd);
                }

                if (isNaN(secFwd) || secFwd <= 0) return message.react('❌').catch(() => {});

                const newPosFwd = Math.min(
                    (player.position || 0) + (secFwd * 1000),
                    player.currentTrack.info.length - 1000
                );
                await player.seekTo(newPosFwd);
                message.react('⏩').catch(() => {});

            } else if (cmdsArray.remove.includes(command)) {
                // ── remove: حذف أغنية من القائمة بالرقم ───────────────────────
                const player = TrueMusic.poru.players.get(message.guild.id);
                if (!player) {
                    return message.reply({ content: '*No music is currently playing.*' });
                }
                const memberVoiceRm = message.member?.voice?.channel;
                const clientVoiceRm = message.guild.members?.me?.voice?.channel;
                if (!memberVoiceRm || !clientVoiceRm || memberVoiceRm.id !== clientVoiceRm.id) return;

                if (!player.queue || player.queue.length === 0) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setThumbnail('attachment://Error.png')
                        .setDescription('*The queue is empty.*');
                    return message.reply({ embeds: [embed], files: ['./settings/image/icons/Error.png'] });
                }

                const posRm = parseInt(args[0]);
                if (isNaN(posRm) || posRm < 1 || posRm > player.queue.length) {
                    const embed = new EmbedBuilder()
                        .setColor(Colors)
                        .setDescription(`*Please provide a position between* **1** *and* **${player.queue.length}**`);
                    return message.reply({ embeds: [embed] });
                }

                const removed = player.queue.splice(posRm - 1, 1)[0];
                const embed = new EmbedBuilder()
                    .setColor(Colors)
                    .setDescription(`*Removed:* **${removed?.info?.title || 'Unknown'}**\n_By:_ **${message.author.displayName}**`);
                return message.reply({ embeds: [embed] });
            }



        });



        TrueMusic.on('interactionCreate', async (interaction) => {
            if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

            const memberVoice = interaction.member?.voice?.channel;
            const clientVoice = interaction.guild.members?.me?.voice?.channel;
            if (!memberVoice || !clientVoice || memberVoice.id !== clientVoice.id) return;

            // ── Select Menus ──────────────────────────────────────────────
            if (interaction.isStringSelectMenu()) {

                // Filter menu
                if (interaction.customId === 'music_filter') {
                    const player = TrueMusic.poru.players.get(interaction.guildId);
                    if (!player || !player.currentTrack) {
                        return interaction.reply({ content: '*لا تشغيل حالياً.*', ephemeral: true });
                    }
                    await interaction.deferReply({ ephemeral: true });
                    const filterType = interaction.values[0];
                    const filterNames = {
                        bassboost: '🎸 باس بوست',
                        nightcore: '🌙 نايت كور',
                        eightd: '🎧 8D صوت',
                        vaporwave: '🌊 فيبور ويف',
                        karaoke: '🎤 كاراوكي',
                        none: '❌ بدون فلتر'
                    };

                    try {
                        switch (filterType) {
                            case 'bassboost':
                                await player.setEQ([
                                    { band: 0, gain: 0.6 }, { band: 1, gain: 0.7 },
                                    { band: 2, gain: 0.8 }, { band: 3, gain: 0.55 },
                                    { band: 4, gain: 0.25 }, { band: 5, gain: 0.0 },
                                ]);
                                break;
                            case 'nightcore':
                                await player.setTimescale({ speed: 1.2, pitch: 1.3, rate: 1 });
                                break;
                            case 'eightd':
                                await player.setRotation({ rotationHz: 0.2 });
                                break;
                            case 'vaporwave':
                                await player.setTimescale({ speed: 0.85, pitch: 0.8, rate: 1 });
                                break;
                            case 'karaoke':
                                await player.setKaraoke({ level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 });
                                break;
                            case 'none':
                            default:
                                await player.clearFilters();
                                break;
                        }
                        await interaction.editReply(`*تم تطبيق الفلتر:* **${filterNames[filterType] || filterType}**`);
                    } catch (e) {
                        await interaction.editReply('*حدث خطأ أثناء تطبيق الفلتر.*');
                    }

                    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
                    return;
                }

                // Artist songs menu
                if (interaction.customId === 'artist_songs') {
                    const player = TrueMusic.poru.players.get(interaction.guildId);
                    if (!player) {
                        return interaction.reply({ content: '*لا تشغيل حالياً.*', ephemeral: true });
                    }
                    await interaction.deferReply({ ephemeral: true });

                    const tracks = artistTracksCache.get(interaction.guildId);
                    if (!tracks) {
                        await interaction.editReply('*انتهت صلاحية قائمة الأغاني، شغل أغنية جديدة.*');
                        setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
                        return;
                    }

                    const idx = parseInt(interaction.values[0]);
                    const selectedTrack = tracks[idx];
                    if (!selectedTrack) {
                        await interaction.editReply('*لم يتم العثور على الأغنية.*');
                        setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
                        return;
                    }

                    selectedTrack.info.requester = interaction.user;
                    player.queue.add(selectedTrack);

                    const aMin = Math.floor(selectedTrack.info.length / 60000);
                    const aSec = Math.floor((selectedTrack.info.length % 60000) / 1000).toString().padStart(2, '0');

                    if (!player.isPlaying && !player.isPaused) player.play();

                    await interaction.editReply(`*تمت الإضافة:* **${selectedTrack.info.title}** \`${aMin}:${aSec}\``);
                    setTimeout(() => interaction.deleteReply().catch(() => {}), 8000);
                    return;
                }

                return;
            }

            // ── Buttons ───────────────────────────────────────────────────
            const getPlayer = () => {
                const player = TrueMusic.poru.players.get(interaction.guildId);
                if (!player || !player.currentTrack) {
                    interaction.reply({ content: '*لا تشغيل حالياً.*', ephemeral: true });
                    return null;
                }
                return player;
            };

            if (!interaction.deferred && !interaction.replied) {
                await interaction.deferReply({ ephemeral: true });
            }

            const player = getPlayer();
            if (!player) return;

            let responseMessage = '';

            // Previous — restart current track or play lastTrack
            if (interaction.customId === 'prev') {
                const restartTrack = player.data.lastTrack || player.currentTrack;
                if (restartTrack) {
                    restartTrack.info.requester = interaction.user;
                    player.queue.unshift(restartTrack);
                    await player.skip();
                    responseMessage = `*⏮️ إعادة تشغيل:* **${restartTrack.info.title}**`;
                } else {
                    responseMessage = '*لا توجد أغنية سابقة.*';
                }
            }

            // Stop
            if (interaction.customId === 'stop') {
                const stored = nowPlayingMessages.get(interaction.guildId);
                if (stored) {
                    clearInterval(stored.intervalId);
                    try { await stored.message.edit({ components: [] }); } catch {}
                    nowPlayingMessages.delete(interaction.guildId);
                }
                player.setLoop('NONE');
                player.queue.clear();
                player.data.autoPlay = false;
                await player.destroy();
                responseMessage = '*⏹️ تم إيقاف التشغيل.*';
            }

            // Loop toggle
            if (interaction.customId === 'loop') {
                const currentLoop = player.loop;
                const newLoopMode = currentLoop === 'NONE' ? 'TRACK' : 'NONE';
                player.setLoop(newLoopMode);
                responseMessage = `*وضع التكرار:* **${newLoopMode === 'TRACK' ? '🔁 ON' : '❌ OFF'}**`;
            }

            // Pause/Resume toggle
            if (interaction.customId === 'pause') {
                if (player.isPaused) {
                    await player.pause(false);
                    responseMessage = '*▶️ استُؤنف التشغيل.*';
                } else {
                    await player.pause(true);
                    responseMessage = '*⏸️ تم الإيقاف المؤقت.*';
                }
            }

            // Volume down
            if (interaction.customId === 'volume_down') {
                const newVolume = Math.max(player.volume - 10, 0);
                player.setVolume(newVolume);
                responseMessage = `*🔉 الصوت:* **${newVolume}%**`;
            }

            // Volume up
            if (interaction.customId === 'volume_up') {
                const newVolume = Math.min(player.volume + 10, 130);
                player.setVolume(newVolume);
                responseMessage = `*🔊 الصوت:* **${newVolume}%**`;
            }

            // Skip
            if (interaction.customId === 'skip') {
                const currentTrack = player.currentTrack;
                if (!currentTrack) {
                    responseMessage = '*لا توجد أغنية للتخطي.*';
                } else if (player.queue.length === 0) {
                    await player.destroy();
                    responseMessage = `*⏭️ تم التخطي:* **${currentTrack.info.title}**`;
                } else {
                    const skippedTrack = player.currentTrack;
                    await player.skip();
                    responseMessage = `*⏭️ تم التخطي:* **${skippedTrack.info.title}**`;
                }
            }

            await interaction.editReply(responseMessage);

            setTimeout(async () => {
                try {
                    await interaction.deleteReply();
                } catch (error) {
                    console.error('Failed to delete reply:', error);
                }
            }, 8000);
        });



        try {
            await TrueMusic.login(token);
        } catch (e) {
            runningBots.delete(token);
            return null;
        }

        return TrueMusic;

    }
}
