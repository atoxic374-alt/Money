const fs = require('fs');
const path = require('path');
const axios = require('axios');

const SWAY_AVATAR_URL = 'https://j.top4top.io/p_3715crnb61.png';
const SWAY_BANNER_URL = 'https://c.top4top.io/p_3715wqk8w2.png';
const { Client, GatewayIntentBits } = require('discord.js');
const { owners, prefix, Botsname } = require(`${process.cwd()}/settings/config`);

module.exports = {
  name: 'musicaddtokens',
  aliases: ["madd-tokens"],
  async execute(client, message) {
    if (!owners.includes(message.author.id)) return;

    const botIntents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ];

    const clientCheck = new Client({ intents: botIntents });

    if (message.author.bot) return;

    const args = message.content.split(' ');
    const command = args.shift().toLowerCase();
    const tokenValues = args;

    if (tokenValues.length === 0) return message.reply('**يرجى إرفاق التوكن بعد الامر.**');

    const validTokens = [];

    for (const tokenValue of tokenValues) {
      try {
        await clientCheck.login(tokenValue);
        validTokens.push(tokenValue);
      } catch (error) {
        if (error.message === 'TOKEN_INVALID') {
          console.error(`❌ Not work! > ${tokenValue}`);
          message.reply(`\`❌ Not work! > ${tokenValue}\``);
        } else {
          console.error(`❌> ${tokenValue}`, error.message);
          message.reply(`\`**❌ Not work!** ${tokenValue}\``);
        }
      }
    }

    if (validTokens.length > 0) {
      let bots = [];
      try {
        const data = fs.readFileSync('./settings/bots.json', 'utf8');
        bots = JSON.parse(data);
        if (!Array.isArray(bots)) {
          bots = [];
        }
      } catch (error) {
        console.error('❌>', error);
      }

      for (const tokenValue of validTokens) {
        const tokenExists = bots.some(bot => bot.token === tokenValue);
        if (!tokenExists) {
          bots.push({ token: tokenValue });
        }
      }
      fs.writeFileSync('./settings/bots.json', JSON.stringify(bots, null, 2));

      function generateRandomNumber() {
        return Math.floor(1000 + Math.random() * 9000); 
      }

      const expectedTimeSeconds = validTokens.length * 5; 
      const minutes = Math.floor(expectedTimeSeconds / 60);
      const seconds = expectedTimeSeconds % 60;
      const formattedTime = `(\`${minutes}:${seconds.toString().padStart(2, '0')}\`)`;

      message.channel.send(`تم إضافة **${validTokens.length}** بوت. سيستغرق تغير الإسم والصورة ${formattedTime}  دقيقة تقريبًا`);
      await message.delete();
      
      setTimeout(async () => {
        for (const tokenValue of validTokens) {
          try {
            const botClient = new Client({ intents: botIntents });
            await botClient.login(tokenValue);

            if (botClient.guilds.cache.size > 0) {
              botClient.guilds.cache.forEach(async guild => {
                try {
                  await guild.leave();
                } catch (leaveError) {
                  console.error(`❌ Error leaving guild ${guild.name}:`, leaveError.message);
                }
              });
            }

            const randomNumber = generateRandomNumber();
            await botClient.user.setUsername(`${Botsname}-${randomNumber}`);
            
            // تغيير صورة البوت
            await botClient.user.setAvatar(SWAY_AVATAR_URL);

// تغيير بنر البوت
            const bannerResp = await axios.get(SWAY_BANNER_URL, { responseType: 'arraybuffer' });
            const base64_banner_image = Buffer.from(bannerResp.data).toString('base64');
            
await axios.patch(`https://discord.com/api/v9/users/@me`, {
              banner: `data:image/png;base64,${base64_banner_image}`
            }, {
              headers: {
                'Authorization': `Bot ${tokenValue}`
              }
            });

            await botClient.destroy();
          } catch (avatarError) {
            console.error(`❌>`, avatarError.message);
          }
        }
      }, 5000);
    }
  }
};
