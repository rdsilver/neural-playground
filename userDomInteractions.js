'use strict';

var prevState;
var controlPanel = {
  onControlPanelClick: function() {
    $('#control-panel div').click(controlPanel.changeState);
  },

  changeState: function(event) {
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
        clearScreen();
        actionPotentialList = {};
        Neuron.resetNeurons();
      }
    }
  },

  onNeuronTypeChange: function() {
    $('#neuronType').change(controlPanel.changeNeuronType);
  },

  changeNeuronType: function(event) {
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
  },

  addMusicalNotes: function() {
    _.times(8, octave => {
      _.each(twelveTones, (tone, index) => {
        $('#noteInput').append($('<option></option>').val((octave+2)*12 + index).html(tone + (octave+1)));
      });
    });
  }
};

var exampleSelection = {
  addExamples: function() {
    _.each(_.keys(exampleNeuronNets), exampleKey => {
      $('#exampleInput').append($('<option></option>').val(exampleKey).html(exampleKey));
    });
  },

  onExampleChange: function() {
    $('#exampleInput').change(exampleSelection.changeExample);
  },

  changeExample: function(event) {
    Neuron.resetNeurons();
    clearScreen();
    Neuron.loadExample($(this).val());
  },

};

$(function() {
  controlPanel.addMusicalNotes();
  controlPanel.onControlPanelClick();
  controlPanel.onNeuronTypeChange();

  exampleSelection.addExamples();
  exampleSelection.onExampleChange();
});
