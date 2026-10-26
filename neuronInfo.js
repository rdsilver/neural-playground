var neuronInfo = {
  fields: {
    activationLevel: () => parseInt($('#activationLevel').val()),
    timeInSeconds: () => parseFloat($('#timerActivationInput').val()),
    maxSteps: () => parseFloat(parseInt($('#timesInput').val())),
    note: () => parseInt($('#noteInput').val()),
    size: () => sketchOptions.cellSize
  },
  Neuron: {
    Create: (neuron) => new Neuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel),
    selectName: 'Normal',
    inputsToShow: () => $('#activationLevelSpan').show()
  },
  CharacterNeuron: {
    Create: (neuron) => new CharacterNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel),
    selectName: 'Character',
    inputsToShow: () => $('#activationLevelSpan').show()
  },
  NegativeNeuron: {
    Create: (neuron) => new NegativeNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel),
    selectName: 'Negative',
    inputsToShow: () => $('#activationLevelSpan').show()
  },
  RandomNeuron: {
    Create: (neuron) => new RandomNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel),
    selectName: 'Random',
    inputsToShow: () => $('#activationLevelSpan').show()
  },
  TimerNeuron: {
    Create: (neuron) => new TimerNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel, neuron.timeInSeconds, neuron.maxSteps),
    selectName: 'Timer',
    inputsToShow: () => $('#timerInputSpan').show(),
    extraFields: ['timeInSeconds', 'maxSteps']
  },
  NoteNeuron: {
    Create: (neuron) => new NoteNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel, neuron.note),
    selectName: 'Note',
    inputsToShow: () => {$('#activationLevelSpan').show();
                         $('#noteInputSpan').show();},
    extraFields: ['note']
  }
};

