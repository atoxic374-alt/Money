const { owners, prefix, Colors } = require(`${process.cwd()}/settings/config`);
const fs = require('fs');
const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'musicstock',
  aliases: ["musicstock"],
  async execute(client, message, args) {

    if (!owners.includes(message.author.id)) return;

    if (message.author.bot) return;

    let bots = [];
    try {
      const data = fs.readFileSync('./settings/bots.json', 'utf8');
      bots = JSON.parse(data);
    } catch (error) {
      console.error('حدث خطأ أثناء قراءة الملف bots.json:', error);
    }

    const botTokenCount = bots.length;
    let tokens = [];
    try {
      const data = fs.readFileSync('./settings/tokens.json', 'utf8');
      tokens = JSON.parse(data);
    } catch (error) {
      console.error('حدث خطأ أثناء قراءة الملف tokens.json:', error);
    }

    const userTokenCount = tokens.length;
    
    const stockColor = userTokenCount === 0 ? 'RED' : 'GREEN';

    const embed = new EmbedBuilder()
      .setColor(Colors) 
      .setDescription(`***Tokens Stock,***\n***works:*** ${userTokenCount} \`${userTokenCount === 0 ? '🔴' : '🟢'}\`\n***Available:*** ${botTokenCount} \`🟢\``)
   
    message.reply({ embeds: [embed] });
  }
};
