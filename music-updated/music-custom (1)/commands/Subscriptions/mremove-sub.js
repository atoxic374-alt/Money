const fs = require('fs');
const path = require('path');
const { owners, prefix, Colors, useEmbeds, logChannelId, Botsname } = require(`${process.cwd()}/settings/config`);
const { EmbedBuilder, Client, GatewayIntentBits } = require('discord.js');

module.exports = {
  name: 'musicremovesub',
  aliases: ["mremove-sub"],
  async execute(client, message, args) {
    if (!owners.includes(message.author.id)) return;
    if (message.author.bot) return;

    const codeToRemove = args[0];
    if (!codeToRemove) return message.reply("**الرجاء تحديد ايدي الاشتراك الذي تريد إزالته.**");

    let removedTokens = [];
    let tokensToRemove = [];
    try {
      const logs = fs.readFileSync('./settings/time.json', 'utf8');
      const logsArray = JSON.parse(logs);

      const matchingSubscriptions = logsArray.filter(entry => entry.code === codeToRemove);

      if (matchingSubscriptions.length === 0) {
        return message.reply("**لا يوجد اشتراكات مرتبطة بهذا الايدي.**");
      }

      const userId = matchingSubscriptions[0].user;

      matchingSubscriptions.forEach(subscription => {
        logsArray.splice(logsArray.indexOf(subscription), 1);
      });

      fs.writeFileSync('./settings/time.json', JSON.stringify(logsArray, null, 2));
      const tokens = fs.readFileSync('./settings/tokens.json', 'utf8');
      let tokensArray = JSON.parse(tokens);
      if (!Array.isArray(tokensArray)) {
        tokensArray = [];
      }

      tokensToRemove = tokensArray.filter(tokenEntry => matchingSubscriptions.some(subscription => tokenEntry.code === subscription.code));
      tokensArray = tokensArray.filter(tokenEntry => !tokensToRemove.includes(tokenEntry));

      const bots = fs.readFileSync('./settings/bots.json', 'utf8');
      let botsArray = JSON.parse(bots);
      if (!Array.isArray(botsArray)) {
        botsArray = [];
      }

      tokensToRemove.forEach(tokenEntry => {
        botsArray.push({
          token: tokenEntry.token
        });
        removedTokens.push(tokenEntry);
      });

      fs.writeFileSync('./settings/bots.json', JSON.stringify(botsArray, null, 2));
      fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokensArray, null, 2));

      // نقدر نستخدم userId هنا في اللوق للمنشن
      setTimeout(async () => {
        removedTokens.forEach(async (token) => {
          try {
            const randomName = `${Botsname}-${Math.floor(Math.random() * (9999 - 1000 + 1)) + 1000}`;

            const botClient = new Client({
              intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
              ],
            });

            await botClient.login(token.token);

            botClient.guilds.cache.forEach(async (guild) => {
              await guild.leave();
            });

            const musicAvatarPath = path.join(process.cwd(), 'settings', 'image', 'music.png');
            await botClient.user.setAvatar(musicAvatarPath);
            await botClient.user.setUsername(randomName);
            await botClient.destroy();
          } catch (error) {
            console.error(`حدث خطأ أثناء تشغيل التوكن: ${error}`);
          }
        });

        const logChannel = client.channels.cache.get(logChannelId);
        if (logChannel) {
          const embed = new EmbedBuilder()
            .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1316233635464220803/512-512-max.png?ex=675a4d99&is=6758fc19&hm=352d005827ec0252e09be31a939f3c2f1abb3c8a0d660f20012ac80a2bc62b12&")
            .setDescription(`\`🟢\` **End Time**\n\n**By : <@${message.author.id}>**\n\`1\` : \`Music x${tokensToRemove.length} (SuID EndCode!)\` : <@${userId}>`)
            .setFooter({ text: `${message.guild.name} | Timer`, iconURL: message.guild.iconURL({ dynamic: true }) })
            .setColor(Colors);
          logChannel.send({ embeds: [embed], content: "```العملية تمت بنجاح، سيتم إلغاء الاشتراك بعد مرور دقيقة.```" });
        } else {
          console.error(`لم يتم العثور على قناة اللوق بالايدي: ${logChannelId}`);
        }

        message.react("👍");
      }, 0);
    } catch (error) {
      console.error('❌>', error);
      message.reply('**حدث خطأ أثناء محاولة إزالة الاشتراك.**');
    }
  }
};
