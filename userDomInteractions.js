var prevState;
var controlPanel = {
  onControlPanelClick: function() {
    $('#control-panel div').on('click', controlPanel.changeState);
  },

  changeState: function() {
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

  changeNeuronType: function() {
    var neuronType = $(this).val();

    // Hide all spans then just show the applicable ones
    _.each($('#neuron-placement span'), span => $(span).hide());
    neuronInfo[neuronType].inputsToShow();
  },

  addNeuronTypes: function() {
    _.each(_.keys(neuronInfo), neuronType => {
      // Make sure this field is a neuron type
      if (neuronInfo[neuronType].selectName) {
        $('#neuronType').append($('<option></option>').val(neuronType).html(neuronInfo[neuronType].selectName));
      }
    });
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

  changeExample: function() {
    Neuron.resetNeurons();
    clearScreen();
    Neuron.loadExample($(this).val());
    Neuron.resizeNeuronList(neuronList, $('#sizeInput').val(), 30);
  },
};


var sizeSelection = {
  onSizeChange: function() {
    $('#sizeInput').change(sizeSelection.changeSize);
  },

  changeSize: function() {
    var newSize = $(this).val();
    var newNeuronList = {};
    var oldSize = sketchOptions.cellSize;

    // TODO WRITE action potential resize
    neuronList = Neuron.resizeNeuronList(neuronList, newSize, oldSize);
    sketchOptions.cellSize = newSize;
    clearScreen();
  }
};

$(() => {
  controlPanel.addNeuronTypes();
  controlPanel.addMusicalNotes();
  controlPanel.onControlPanelClick();
  controlPanel.onNeuronTypeChange();

  exampleSelection.addExamples();
  exampleSelection.onExampleChange();

  sizeSelection.onSizeChange();
});
