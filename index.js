// Import necessary modules

// const { EventEmitter } = require('events');
// EventEmitter.defaultMaxListeners = 999999999999999;
require('events').defaultMaxListeners = 0;

const {
    Client,
    GatewayIntentBits,
    Collection,
    EmbedBuilder,
} = require('discord.js');

const fs = require('fs');
const {
    prefix,
    Colors,
    Token,
    logChannelId
} = require(`${process.cwd()}/settings/config`);

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: ['CHANNEL', 'MESSAGE', 'USER', 'GUILD_MEMBER'],
    allowedMentions: {
        parse: ['users'],
        repliedUser: true
    }
});

client.prefix = prefix;
module.exports = client;

client.commands = new Collection();
require("./handler/index.js")(client);
require('./music.js');
require('./manager.js');



    client.on('error', error => console.log(error))
      .on('warn', info => console.log(info))
      .on('disconnecting', () => console.log("Bot is disconnecting...", "warn"))
      .on('reconnecting', () => console.log("Bot reconnecting...", "log"))
      .on('error', e => console.log(e, "error"))
      .on('warn', info => console.log(info, "warn"));

    process.on('unhandledRejection', reason => {
      console.log(reason.stack ? reason.stack : reason);
    })
      .on('uncaughtException', (err) => {
        console.log(err.stack ? err.stack : err);
      })
      .on('uncaughtExceptionMonitor', (err) => {
        console.log(err.stack ? err.stack : err);
      });

client.once('ready', () => {
    setInterval(checkSubscriptions, 30000);
    });
    
    function checkSubscriptions() {
    try {
      const logs = fs.readFileSync('./settings/time.json', 'utf8');
      const logsArray = JSON.parse(logs);
    
      const logChannel = client.channels.cache.find(channel => channel.id === logChannelId);
    
      logsArray.forEach((log, index) => {
        const remainingTime = log.expirationTime - Date.now();
        if (remainingTime <= 0) {
          const user = client.users.cache.get(log.user);
          
          if (user) {
            const userembed = new EmbedBuilder()
            .setTitle("إشعار انتهى اشتراك! 🔔")
            .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1316233635464220803/512-512-max.png?ex=675a4d99&is=6758fc19&hm=352d005827ec0252e09be31a939f3c2f1abb3c8a0d660f20012ac80a2bc62b12&")
            .setDescription(`> الإسم : <@${user.id}>\n> ألاشتراك : \`Music x${log.botsCount}\` \`(SuID ${log.code})\`\n> بدأ فيـ : \`${new Date(log.expirationTime).toLocaleString()}\``)
            .setColor(Colors);
            
               user.send({ content: `> <@${user.id}>`, embeds: [userembed] })
              .catch(error => console.error(`Could not send DM to ${user.tag}.\n`, error)); 
                  
    
            const embed = new EmbedBuilder()
            .setTitle("إشعار انتهى اشتراك! 🔔")
            .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1316233635464220803/512-512-max.png?ex=675a4d99&is=6758fc19&hm=352d005827ec0252e09be31a939f3c2f1abb3c8a0d660f20012ac80a2bc62b12&")
            .setDescription(`> الإسم : <@${user.id}>\n> ألاشتراك : \`Music x${log.botsCount}\` \`(SuID ${log.code})\`\n> بدأ فيـ : \`${new Date(log.expirationTime).toLocaleString()}\``)
            .setColor(Colors);
            
            logChannel.send({ content: "```العملية تمت بنجاح، وتم حذف أشتراك العميل.```", embeds: [embed] });
             
          }
    
          logsArray.splice(index, 1);
          const tokens = fs.readFileSync('./settings/tokens.json', 'utf8');
          const tokensArray = JSON.parse(tokens);
    
          const tokensToRemove = tokensArray.filter(tokenEntry => tokenEntry.code === log.code);
    
          const bots = fs.readFileSync('./settings/bots.json', 'utf8');


          const botsArray = JSON.parse(bots);
    
          tokensToRemove.forEach(tokenEntry => {
            botsArray.push({
              token: tokenEntry.token,
            });
          });
    
          fs.writeFileSync('./settings/bots.json', JSON.stringify(botsArray, null, 2));
    
          const updatedTokensArray = tokensArray.filter(tokenEntry => !tokensToRemove.includes(tokenEntry));
          fs.writeFileSync('./settings/tokens.json', JSON.stringify(updatedTokensArray, null, 2));
        }
      });
      fs.writeFileSync('./settings/time.json', JSON.stringify(logsArray, null, 2));
    } catch (error) {
      console.error('❌>', error);
    }
    }


client.login(Token);