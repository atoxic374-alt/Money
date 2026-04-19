const fs = require('fs');
const { owners, Colors, logChannelId } = require(`${process.cwd()}/settings/config`);
const { EmbedBuilder } = require('discord.js');
const ms = require('ms');


module.exports = {
  name: 'musicaddsub',
  aliases: ["madd-sub"],
  async execute(client, message, args) {
    if (!owners.includes(message.author.id)) return;
    if (message.author.bot) return;

    const mention = message.mentions.members.first();
    if (!mention) return message.reply("**يرجى إرفاق منشن الشخص.**");

    const userId = mention.id;
    const serverId = args[1];
    if (!serverId) return message.reply("**يرجى إرفاق ايدي السيرفر.**");

    let bots = [];
    try {
      const data = fs.readFileSync('./settings/bots.json', 'utf8');
      bots = JSON.parse(data);
    } catch (error) {
      console.error('❌> حدث خطأ أثناء قراءة الملف bots.json:', error);
      return message.reply('**حدث خطأ أثناء قراءة ملف البوتات.**');
    }

    const count = parseInt(args[2]);
    if (!count || count <= 0 || count > bots.length) {
      return message.reply('**يرجى إدخال عدد صحيح للبوتات.**');
    }

    const subscriptionTime = args[3];
    const subscriptionDuration = ms(subscriptionTime);
    if (!subscriptionDuration) return message.reply("**يرجى إدخال وقت صحيح للاشتراك.**");

    const formattedDuration = formatDuration(subscriptionDuration);

    const expirationTime = Date.now() + subscriptionDuration;
    const randomCode = generateRandomCode(5);

    const timeData = {
      user: userId,
      server: serverId,
      botsCount: count,
      subscriptionTime: subscriptionTime,
      expirationTime: expirationTime,
      code: `#${randomCode}`
    };

    try {
      const time = fs.readFileSync('./settings/time.json', 'utf8');
      const timeArray = JSON.parse(time);
      timeArray.push(timeData);
      fs.writeFileSync('./settings/time.json', JSON.stringify(timeArray, null, 2));
    } catch (error) {
      console.error('❌> حدث خطأ أثناء كتابة ملف الوقت:', error);
    }

    const givenTokens = bots.splice(0, count);
    let tokens = [];
    try {
      const tokensData = fs.readFileSync('./settings/tokens.json', 'utf8');
      tokens = JSON.parse(tokensData);
      if (!Array.isArray(tokens)) {
        tokens = [];
      }
    } catch (error) {
      console.error('❌> حدث خطأ أثناء قراءة ملف التوكنات:', error);
    }

    givenTokens.forEach(token => {
      tokens.push({
        token: token.token,
        Server: serverId,
        channel: null,
        chat: null,
        status: null,
        client: userId,
        code: `#${randomCode}`
      });
    });

    const logChannel = client.channels.cache.get(logChannelId);
    if (!logChannel) return;

    await mention.send({
      content: "\`\`\`الشراء ناجح. اشتراكك مفعل الآن.\`\`\`",
      embeds: [
        new EmbedBuilder()
          .setAuthor({ name: mention.user.username, iconURL: mention.user.displayAvatarURL({ dynamic: true, size: 1024, format: 'png' }) })
          .setDescription(`\`1\` : \`Music (SuID #${randomCode}) : ${formattedDuration}\` <@${userId}>`)
          .setFooter({ text: `${message.guild.name} | Timer`, iconURL: message.guild.iconURL({ dynamic: true }) })
          .setColor(Colors)

      ]
    }).catch(error => {
      console.error(`❌> فشل إرسال الرسالة إلى ${mention.user.tag}:`, error);
    });



    const embed = new EmbedBuilder()
      .setTitle("إضافة اشتراك! ✅")
      .setThumbnail("https://cdn.discordapp.com/attachments/1091536665912299530/1316233635464220803/512-512-max.png?ex=675a4d99&is=6758fc19&hm=352d005827ec0252e09be31a939f3c2f1abb3c8a0d660f20012ac80a2bc62b12&")
      .setDescription(`> بواسطّة : <@${message.author.id}>\n\`1\` : \`Music (SuID #${randomCode}) : ${formattedDuration}\` <@${userId}>`)
      .setFooter({ text: `${message.guild.name} | Timer`, iconURL: message.guild.iconURL({ dynamic: true }) })
      .setColor(Colors);

    logChannel.send({ embeds: [embed] });

    fs.writeFileSync('./settings/tokens.json', JSON.stringify(tokens, null, 2));
    fs.writeFileSync('./settings/bots.json', JSON.stringify(bots, null, 2));

    message.react('✅');
  }
};

function generateRandomCode(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    code += characters.charAt(randomIndex);
  }
  return code;
}

function formatDuration(msValue) {
  const days = Math.floor(msValue / (1000 * 60 * 60 * 24));
  const hours = Math.floor((msValue % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((msValue % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((msValue % (1000 * 60)) / 1000);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}