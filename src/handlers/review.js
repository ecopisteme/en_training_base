

export async function processReview(interaction) {
  await interaction.editReply('⚠️ 目前尚未實作 /review 功能');
}


export { processReview as handleReview };