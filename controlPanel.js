// TODO refactor these methods out into an object

$(function() {
	var prevState;
    $('#control-panel div').click(function() {
		if(!$(this).hasClass('active')) {
			$('#control-panel div').removeClass('active');
			$(this).addClass('active');
			prevState = state;
			state = $(this).data('state');

			// If we are out of connection mode, unselect neuron
			if (state !== 'connectNeurons') {
				Neuron.unSelectNeuron();
			}

			// If we arn't in live mode anymore, clear the grid, action potentials and all neuron charges
			// Call restart function on every neuron
			if (state !== 'live' && prevState === 'live') {
				clearGrid(true);
				actionPotentialList = {};
				Neuron.resetNeurons();
			}
		}
	});

	$('#neuron-type').change(function(){
		neuronType = $(this).val();

		// Hide all spans then just show the applicable ones
		_.each($('#neuron-placement span'), span => $(span).hide());

		switch(neuronType) {
			case 'timer':
				$('#timerInputSpan').show();
				break;
			case 'note':
				$('#activationLevelSpan').show();
				$('#noteInputSpan').show();
				break;
			default:
				$('#activationLevelSpan').show();
		}
	});
});