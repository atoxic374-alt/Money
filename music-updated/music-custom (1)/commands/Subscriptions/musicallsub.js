const fs = require('fs');
const { owners, Colors } = require(`${process.cwd()}/settings/config`);
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
  name: 'musicallsub',
  async execute(client, message, args) {
    if (!owners.includes(message.author.id)) return;

    try {
      const logs = fs.readFileSync('./settings/time.json', 'utf8');
      const logsArray = JSON.parse(logs);

      if (logsArray.length === 0) {
        return message.reply('**لا توجد اشتراكات مسجلة حاليًا.**');
      }

      logsArray.sort((a, b) => (b.expirationTime - Date.now()) - (a.expirationTime - Date.now()));

      const subscriptionsPerPage = 15;
      const totalPages = Math.ceil(logsArray.length / subscriptionsPerPage);
      let currentPage = 1;

      const generateEmbed = (page) => {
        const embed = new EmbedBuilder()
          .setColor(Colors)
          .setFooter({
            text: `${message.client.user.username} | Timer`,
            iconURL: `${message.client.user.displayAvatarURL({ dynamic: true })}`
          });

        const start = (page - 1) * subscriptionsPerPage;
        const end = start + subscriptionsPerPage;
        const subscriptionsToShow = logsArray.slice(start, end);

        let description = ''; 

        subscriptionsToShow.forEach((userSubscription, index) => {
          const expirationTime = userSubscription.expirationTime;
          const remainingTime = expirationTime - Date.now();

          const days = Math.floor(remainingTime / (1000 * 60 * 60 * 24));
          const hours = Math.floor((remainingTime % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          const minutes = Math.floor((remainingTime % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((remainingTime % (1000 * 60)) / 1000);

          const formattedTime = `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds ? `${seconds}s` : ''}`;

         
          description += `\`${start + index + 1}\` : \`Music x${userSubscription.botsCount} (SuID ${userSubscription.code})\` : \`${formattedTime}\` : <@${userSubscription.user}>\n`;

        });

        embed.setDescription(description);

        return embed;
      };

      const generateButtons = () => {
        const previousButton = new ButtonBuilder()
          .setCustomId('previous')
          .setEmoji("1251766205111468043")
          .setStyle('Secondary')
          .setDisabled(currentPage === 1);

        const deleteButton = new ButtonBuilder()
          .setCustomId('deleteButton')
          .setEmoji("1240135421434925076")
          .setStyle('Danger');

        const nextButton = new ButtonBuilder()
          .setCustomId('next')
          .setEmoji("1251766110022537256")
          .setStyle('Secondary')
          .setDisabled(currentPage === totalPages);

        return new ActionRowBuilder().addComponents(previousButton, deleteButton, nextButton);
      };

      const messageToSend = await message.reply({ embeds: [generateEmbed(currentPage)], components: [generateButtons()] });

      const filter = i => i.user.id === message.author.id;
      const collector = messageToSend.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async i => {
        if (i.customId === 'previous') {
          currentPage = Math.max(1, currentPage - 1);
        } else if (i.customId === 'next') {
          currentPage = Math.min(totalPages, currentPage + 1);
        } else if (i.customId === 'deleteButton') {
          await messageToSend.delete().catch(err => console.error('Failed to delete message:', err));
          message.react("✅");
          collector.stop('deleted');
          return;
        }

        await i.update({ embeds: [generateEmbed(currentPage)], components: [generateButtons()] });
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          messageToSend.edit({ embeds: [generateEmbed(currentPage)], components: [] });
        }
      });

    } catch (error) {
      console.error('❌>', error);
      message.reply('\`\`\`.حدث خطأ، يرجى التواصل مع الدعم الفن\`\`\`');
    }
  }
};
