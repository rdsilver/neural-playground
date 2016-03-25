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
    selectName: 'Normal'
  },
  CharacterNeuron: {
    Create: (neuron) => new CharacterNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel),
    selectName: 'Character'
  },
  NegativeNeuron: {
    Create: (neuron) => new NegativeNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel),
    selectName: 'Negative'
  },
  RandomNeuron: {
    Create: (neuron) => new RandomNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel),
    selectName: 'Random'
  },
  TimerNeuron: {
    Create: (neuron) => new TimerNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel, neuron.timeInSeconds, neuron.maxSteps),
    selectName: 'Timer',
    extraFields: ['timeInSeconds', 'maxSteps']
  },
  NoteNeuron: {
    Create: (neuron) => new NoteNeuron(neuron.x, neuron.y, neuron.size, neuron.activationLevel, neuron.note),
    selectName: 'Note',
    extraFields: ['note']
  }
};

